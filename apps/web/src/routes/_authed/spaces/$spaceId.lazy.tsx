import { useState } from "react";
import { createLazyFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useQueryErrorResetBoundary,
  useSuspenseQuery,
} from "@tanstack/react-query";
import type { Space, SpaceMember } from "@ossmeet/db/schema";
import { getAssetUrl, listSpaceAssets } from "@/server/assets";
import { deleteSpace, updateSpace } from "@/server/spaces";
import { queryKeys } from "@/lib/query-keys";
import { spaceAssetsQueryOptions } from "@/queries/assets";
import { spaceQueryOptions } from "@/queries/spaces";
import { MembersList } from "@/components/spaces/members-list";
import { SpaceHeader } from "@/components/spaces/space-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  Files,
  FileText,
  Presentation,
  Settings,
  Trash,
  Users,
  Video,
} from "lucide-react";

export const Route = createLazyFileRoute("/_authed/spaces/$spaceId")({
  component: SpaceDetailPage,
  pendingComponent: () => (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  ),
  errorComponent: SpaceDetailError,
});

function SpaceDetailError({ error }: { error: Error }) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-neutral-500">{error.message || "Failed to load space"}</p>
      <button
        onClick={() => {
          queryErrorResetBoundary.reset();
          router.invalidate();
        }}
        className="text-sm font-medium text-accent-700 hover:text-accent-800"
      >
        Retry
      </button>
    </div>
  );
}

interface SpaceMemberWithUser extends SpaceMember {
  user: {
    id: string;
    name: string;
    image: string | null;
    plan?: string;
    role?: string;
  } | null;
}

type ListedAsset = Awaited<ReturnType<typeof listSpaceAssets>>["assets"][number];

const assetIcons = {
  pdf: FileText,
  recording: Video,
  whiteboard_snapshot: Presentation,
  whiteboard_state: Presentation,
  whiteboard_pdf: FileText,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SpaceDetailPage() {
  const { spaceId } = Route.useParams();
  const { data } = useSuspenseQuery(spaceQueryOptions(spaceId));
  const { data: assetsData } = useSuspenseQuery(spaceAssetsQueryOptions(spaceId));

  const { space, role } = data;
  const assets = assetsData.assets;
  const isAdmin = role === "owner" || role === "admin";

  return (
    <div>
      <SpaceHeader
        spaceId={spaceId}
        name={space.name}
        description={space.description}
        role={role}
        memberCount={space.members.length}
      />

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            <Users size={16} />
            Members
            <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
              {space.members.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="assets">
            <Files size={16} />
            Assets
            <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
              {assets.length}
            </span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="settings">
              <Settings size={16} />
              Settings
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members">
          <MembersList spaceId={spaceId} members={space.members} isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="assets">
          <AssetsPanel assets={assets} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="settings">
            <SettingsPanel spaceId={spaceId} space={space} role={role} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AssetsPanel({ assets }: { assets: ListedAsset[] }) {
  if (assets.length === 0) {
    return (
      <EmptyState
        icon={Files}
        title="No assets yet"
        description="Meeting recordings, whiteboard snapshots, and PDFs will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {assets.map((asset) => {
        const Icon = assetIcons[asset.type as keyof typeof assetIcons] || Files;

        return (
          <div
            key={asset.id}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3 transition-colors hover:bg-neutral-50"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-neutral-100 p-2">
                <Icon size={18} className="text-neutral-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-900">{asset.filename}</p>
                <p className="text-xs text-neutral-500">
                  {asset.type.replace("_", " ")} &middot; {asset.size ? formatBytes(asset.size) : "—"}
                </p>
              </div>
            </div>
            <button
              className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-accent-50 hover:text-accent-700"
              onClick={async () => {
                const result = await getAssetUrl({ data: { assetId: asset.id } });
                window.open(result.url, "_blank");
              }}
            >
              <Download size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SettingsPanel({
  spaceId,
  space,
  role,
}: {
  spaceId: string;
  space: Space & { members: SpaceMemberWithUser[] };
  role: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editName, setEditName] = useState(space.name);
  const [editDesc, setEditDesc] = useState(space.description || "");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (input: { name?: string; description?: string }) =>
      updateSpace({ data: { spaceId, ...input } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.spaces.detail(spaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all() }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSpace({ data: { spaceId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all() });
      navigate({ to: "/spaces" });
    },
  });

  function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    updateMutation.mutate({
      name: editName.trim(),
      description: editDesc.trim(),
    });
  }

  return (
    <div className="max-w-lg space-y-8">
      <form onSubmit={handleUpdate} className="space-y-4">
        <h3 className="text-base font-semibold text-neutral-900">Space details</h3>
        <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
        <Input
          label="Description"
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="Add a description..."
        />
        <Button type="submit" loading={updateMutation.isPending} disabled={!editName.trim()}>
          Save changes
        </Button>
        {updateMutation.isSuccess && !updateMutation.isPending && (
          <p className="text-sm text-success-600">Changes saved!</p>
        )}
        {updateMutation.isError && (
          <p className="text-sm text-danger-600">Failed to save changes. Please try again.</p>
        )}
      </form>

      {role === "owner" && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 p-4">
          <h3 className="text-sm font-semibold text-danger-800">Danger zone</h3>
          <p className="mt-1 text-xs text-danger-700">
            Deleting this space is permanent and cannot be undone.
          </p>
          <Button variant="danger" size="sm" className="mt-3" onClick={() => setDeleteOpen(true)}>
            <Trash size={14} className="mr-1.5" />
            Delete space
          </Button>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <div className="p-6">
            <DialogTitle>Delete space</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{space.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => deleteMutation.mutate()}
                loading={deleteMutation.isPending}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
