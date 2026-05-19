import { useState } from "react";
import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useQueryErrorResetBoundary,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createSpace } from "@/server/spaces";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { mySpacesQueryOptions } from "@/queries/spaces";
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
import { SpaceCard } from "@/components/spaces/space-card";
import { Globe, Plus, Search } from "lucide-react";
import type { getMySpaces } from "@/server/spaces";

type ListedSpace = Awaited<ReturnType<typeof getMySpaces>>["spaces"][number];

export const Route = createLazyFileRoute("/_authed/spaces/")({
  component: SpacesPage,
  pendingComponent: () => (
    <div className="flex h-64 items-center justify-center">
      <Spinner size="lg" brand />
    </div>
  ),
  errorComponent: SpacesError,
});

function SpacesError({ error }: { error: Error }) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-neutral-500">{error.message || "Failed to load spaces"}</p>
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

function SpacesPage() {
  const { data } = useSuspenseQuery(mySpacesQueryOptions());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createSpace({ data: input }),
    onMutate: async () => {
      setDialogOpen(false);
      setName("");
      setDescription("");
    },
    onError: () => {
      setDialogOpen(true);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.spaces.all() });
    },
  });

  const filteredSpaces: ListedSpace[] = data.spaces.filter((space: ListedSpace) =>
    space.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
    });
  }

  return (
    <div>
      <div className="relative rounded-3xl overflow-hidden p-8 lg:p-10 bg-white shadow-sm ring-1 ring-black/5 mb-8">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-stone-900 font-heading">
              Spaces
            </h1>
            <p className="mt-2 text-stone-500 font-medium">
              Organize your meetings, files, and team members.
            </p>
          </div>
          <Button variant="accent" size="lg" className="shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40 hover:-translate-y-0.5 transition-all h-12 rounded-xl text-base font-medium" onClick={() => setDialogOpen(true)}>
            <Plus size={18} className="mr-2" />
            Create Space
          </Button>
        </div>
      </div>

      {data.spaces.length > 0 && (
        <div className="mt-5">
          <Input
            placeholder="Search spaces..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search size={18} />}
            className="max-w-xs"
          />
        </div>
      )}

      {data.spaces.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No spaces yet"
          description="Create a space to organize your meetings, files, and team members."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus size={16} className="mr-1.5" />
              Create your first space
            </Button>
          }
        />
      ) : filteredSpaces.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching spaces"
          description="Try a different search term."
          className="mt-8"
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredSpaces.map((space: ListedSpace, index: number) => (
            <SpaceCard
              key={space.id}
              id={space.id}
              name={space.name}
              description={space.description}
              role={space.role}
              index={index}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <div className="p-6">
            <DialogTitle>Create a new space</DialogTitle>
            <DialogDescription>
              Spaces help you organize meetings, files, and team members.
            </DialogDescription>
            <form onSubmit={handleCreate} className="mt-5 space-y-4">
              <Input
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Marketing Team"
                required
                autoFocus
              />
              <Input
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this space for? (optional)"
              />
              {createMutation.error && (
                <p className="text-sm text-red-600">
                  {getErrorMessage(createMutation.error, "Failed to create space")}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={createMutation.isPending}
                  disabled={!name.trim()}
                >
                  Create Space
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
