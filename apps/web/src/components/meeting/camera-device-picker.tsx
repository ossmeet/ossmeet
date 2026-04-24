import { useState, useCallback } from "react";
import { Video, Check, RefreshCw } from "lucide-react";
import { cn } from "@ossmeet/shared";
import { PopoverRoot, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface CameraDevicePickerProps {
  videoDevices: MediaDeviceInfo[];
  currentDeviceId: string | undefined;
  isCameraOn: boolean;
  onSelectDevice: (deviceId: string) => void;
  onRefreshDevices?: () => void;
}

export function CameraDevicePicker({
  videoDevices,
  currentDeviceId,
  isCameraOn,
  onSelectDevice,
  onRefreshDevices,
}: CameraDevicePickerProps) {
  return (
    <div className="w-56 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-white/60">Select camera</p>
        {onRefreshDevices && (
          <button
            onClick={onRefreshDevices}
            className="flex h-5 w-5 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
            title="Refresh devices"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto overscroll-contain space-y-1">
        {videoDevices.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-white/40">
            No cameras found
          </p>
        ) : (
          videoDevices.map((device) => (
            <button
              key={device.deviceId}
              onClick={() => onSelectDevice(device.deviceId)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-all",
                currentDeviceId === device.deviceId
                  ? "bg-accent-500/20 text-accent-300"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                  currentDeviceId === device.deviceId
                    ? "bg-accent-500/30"
                    : "bg-white/10"
                )}
              >
                {currentDeviceId === device.deviceId ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Video className="h-3.5 w-3.5" />
                )}
              </div>
              <span className="truncate flex-1">
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </span>
            </button>
          ))
        )}
      </div>

      {!isCameraOn && videoDevices.length > 0 && (
        <p className="mt-2 border-t border-white/10 px-1 pt-2 text-2xs text-white/40">
          Turn on video to switch cameras
        </p>
      )}
    </div>
  );
}

interface CameraDeviceButtonProps extends CameraDevicePickerProps {
  disabled?: boolean;
}

export function CameraDeviceButton({
  videoDevices,
  currentDeviceId,
  isCameraOn,
  onSelectDevice,
  onRefreshDevices,
  disabled = false,
}: CameraDeviceButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback((deviceId: string) => {
    onSelectDevice(deviceId);
    setOpen(false);
  }, [onSelectDevice]);

  const button = (
    <button
      type="button"
      disabled={disabled || videoDevices.length <= 1}
      aria-label="Switch camera"
      title={videoDevices.length <= 1 ? "No other cameras available" : "Switch camera"}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-150",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30",
        disabled || videoDevices.length <= 1
          ? "cursor-not-allowed opacity-40"
          : "text-neutral-600 hover:bg-neutral-300/70 hover:text-neutral-900",
      )}
    >
      <Video className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );

  return (
    <div className="relative">
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={button} />
        <PopoverContent
          side="top"
          className="rounded-xl bg-stone-900/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
        >
          <CameraDevicePicker
            videoDevices={videoDevices}
            currentDeviceId={currentDeviceId}
            isCameraOn={isCameraOn}
            onSelectDevice={handleSelect}
            onRefreshDevices={onRefreshDevices}
          />
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}
