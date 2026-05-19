import { Bell } from "lucide-react";
import { SettingsSection } from "./settings-section";

export function NotificationsSection() {
  return (
    <SettingsSection icon={Bell} title="Notifications">
      <p className="text-sm text-neutral-500">
        Notification preferences coming soon.
      </p>
    </SettingsSection>
  );
}
