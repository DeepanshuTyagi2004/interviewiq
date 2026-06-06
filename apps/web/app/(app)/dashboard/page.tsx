import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Your interview prep at a glance.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Practice stats and recent sessions will appear here. For now, build
            your profile by connecting sources.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Head to Connections to link your GitHub account.
        </CardContent>
      </Card>
    </div>
  );
}
