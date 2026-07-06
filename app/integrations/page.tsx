"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  MoreVertical,
  Store,
  RefreshCcw,
  PlugZap,
  CheckCircle2,
} from "lucide-react";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export default function IntegrationsPage() {
  const integrations =
    useQuery(api.integrations.getAllIntegrations) ?? [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIntegration, setSelectedIntegration] = useState<any>(null);

  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      const query = searchTerm.toLowerCase();

      return (
        integration.provider?.toLowerCase().includes(query) ||
        integration.domain?.toLowerCase().includes(query)
      );
    });
  }, [integrations, searchTerm]);

  const connectedCount = integrations.length;

  const shopifyCount = integrations.filter(
    (i) => i.provider === "shopify"
  ).length;

  const columns = [
    {
      key: "provider",
      label: "Provider",
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Store className="w-4 h-4" />
          </div>

          <div>
            <p className="font-medium capitalize">{value}</p>
            <p className="text-xs text-muted-foreground">
              Ecommerce Integration
            </p>
          </div>
        </div>
      ),
    },

    {
      key: "domain",
      label: "Store Domain",
      render: (value: string) => (
        <span className="font-medium">
          {value || "-"}
        </span>
      ),
    },

    {
      key: "status",
      label: "Status",
      render: () => (
        <Badge
          variant="secondary"
          className="bg-green-500/10 text-green-600"
        >
          Connected
        </Badge>
      ),
    },

    {
      key: "_creationTime",
      label: "Connected",
      render: (value: number) => (
        <span className="text-sm text-muted-foreground">
          {new Date(value).toLocaleDateString()}
        </span>
      ),
    },

    {
      key: "actions",
      label: "",
      render: (_: any, row: any) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setSelectedIntegration(row)}
            >
              View Details
            </DropdownMenuItem>

            <DropdownMenuItem>
              Sync Now
            </DropdownMenuItem>

            <DropdownMenuItem>
              Reconnect
            </DropdownMenuItem>

            <DropdownMenuItem className="text-destructive">
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Integrations
          </h1>

          <p className="text-muted-foreground mt-1">
            Connect external platforms and manage data sync.
          </p>
        </div>

        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Integration
        </Button>
      </div>

      {/* STATS */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Connected Integrations
                </p>

                <h3 className="text-3xl font-bold">
                  {connectedCount}
                </h3>
              </div>

              <PlugZap className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Shopify Stores
                </p>

                <h3 className="text-3xl font-bold">
                  {shopifyCount}
                </h3>
              </div>

              <Store className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Sync Health
                </p>

                <h3 className="text-3xl font-bold text-green-600">
                  100%
                </h3>
              </div>

              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SEARCH */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

        <input
          value={searchTerm}
          onChange={(e) =>
            setSearchTerm(e.target.value)
          }
          placeholder="Search integrations..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background"
        />
      </div>

      {/* TABLE */}
      <DataTable
        columns={columns}
        data={filteredIntegrations}
        pageSize={10}
        onRowClick={setSelectedIntegration}
      />


        <Sheet
            open={!!selectedIntegration}
            onOpenChange={() => setSelectedIntegration(null)}
        >
            <SheetContent
                side="right"
                className="w-full sm:max-w-xl px-4 overflow-y-auto"
            >
                {selectedIntegration && (
                <>
                    <SheetHeader className="pb-6">
                    <SheetTitle className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Store className="w-5 h-5" />
                        </div>

                        <div>
                        <p className="capitalize">
                            {selectedIntegration.provider}
                        </p>

                        <p className="text-sm font-normal text-muted-foreground">
                            {selectedIntegration.domain}
                        </p>
                        </div>
                    </SheetTitle>

                    <SheetDescription>
                        Integration details and sync information
                    </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6">
                    {/* Status */}
                    <Card>
                        <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                            <p className="text-sm text-muted-foreground">
                                Connection Status
                            </p>

                            <p className="font-semibold mt-1">
                                Connected
                            </p>
                            </div>

                            <Badge className="bg-green-500/10 text-green-600">
                            Active
                            </Badge>
                        </div>
                        </CardContent>
                    </Card>

                    {/* Store Details */}
                    <Card>
                        <CardHeader>
                        <CardTitle>Store Details</CardTitle>
                        </CardHeader>

                        <CardContent className="space-y-4">
                        <div>
                            <p className="text-xs text-muted-foreground">
                            Provider
                            </p>

                            <p className="font-medium capitalize">
                            {selectedIntegration.provider}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground">
                            Domain
                            </p>

                            <p className="font-medium break-all">
                            {selectedIntegration.domain}
                            </p>
                        </div>

                        <div>
                            <p className="text-xs text-muted-foreground">
                            Connected On
                            </p>

                            <p className="font-medium">
                            {new Date(
                                selectedIntegration._creationTime
                            ).toLocaleString()}
                            </p>
                        </div>
                        </CardContent>
                    </Card>

                    {/* Shopify Data */}
                    {selectedIntegration.storeData && (
                        <Card>
                        <CardHeader>
                            <CardTitle>Store Metadata</CardTitle>
                            <CardDescription>
                            Information retrieved from Shopify
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <pre className="rounded-lg bg-muted p-4 text-xs overflow-auto max-h-[300px]">
                            {JSON.stringify(
                                selectedIntegration.storeData,
                                null,
                                2
                            )}
                            </pre>
                        </CardContent>
                        </Card>
                    )}

                    {/* Sync Stats */}
                    <Card>
                        <CardHeader>
                        <CardTitle>Sync Activity</CardTitle>
                        </CardHeader>

                        <CardContent className="space-y-4">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                            Products Synced
                            </span>

                            <span className="font-medium">
                            0
                            </span>
                        </div>

                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                            Orders Synced
                            </span>

                            <span className="font-medium">
                            0
                            </span>
                        </div>

                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                            Last Sync
                            </span>

                            <span className="font-medium">
                            Never
                            </span>
                        </div>
                        </CardContent>
                    </Card>

                    {/* Actions */}
                    <div className="sticky bottom-0 bg-background pt-4 border-t">
                        <div className="flex gap-2">
                        <Button className="flex-1">
                            <RefreshCcw className="w-4 h-4 mr-2" />
                            Sync Now
                        </Button>

                        <Button
                            variant="outline"
                            className="flex-1"
                        >
                            Reconnect
                        </Button>
                        </div>

                        <Button
                        variant="destructive"
                        className="w-full mt-2"
                        >
                        Disconnect Integration
                        </Button>
                    </div>
                    </div>
                </>
                )}
            </SheetContent>
        </Sheet>
    </div>
  );
}
