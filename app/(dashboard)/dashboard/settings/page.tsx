import { Bell, Shield, Users2 } from "lucide-react";

import { Panel } from "@/components/ui/panel";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Team, notifications, and approval preferences.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="gap-3 p-5">
          <Users2 className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Team rules</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Define who can approve sandbox runs, replay verifications, or change repository policy.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <Bell className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Notifications</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Choose when Repo Butler reports triage completions, verifier failures, and escalations.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <Shield className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Safety defaults</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Tune network restrictions, secret scrubbing, and reproduction approval thresholds.
          </p>
        </Panel>
      </div>
    </div>
  );
}
