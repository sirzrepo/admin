
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

import {
  Plus,
  Search,
  RefreshCcw,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  MoreVertical,
  PlugZap,
} from "lucide-react";

import {
  Card,
  CardContent,
} from "@/components/ui/card";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  brandId: string;
}

export default function PlatformConnectionsPage({
  brandId,
}: Props) {
  const connections =
    useQuery(
      api.platformConnections.getAllPlatformConnections,
      {}
    ) ?? [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedConnection, setSelectedConnection] =
    useState<any>(null);

  const filteredConnections = useMemo(() => {
    const query = searchTerm.toLowerCase();

    return connections.filter((connection) =>
      [
        connection.platform,
        connection.accountName,
        connection.accountId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [connections, searchTerm]);

  const stats = {
    total: connections.length,
    active: connections.filter(
      (c) => c.isActive
    ).length,
    expired: connections.filter(
      (c) =>
        c.expiresAt &&
        c.expiresAt < Date.now()
    ).length,
  };

  const getPlatformColor = (
    platform: string
  ) => {
    switch (platform) {
      case "instagram":
        return "bg-pink-500/10 text-pink-500";

      case "facebook":
        return "bg-blue-500/10 text-blue-500";

      case "tiktok":
        return "bg-zinc-500/10 text-zinc-300";

      case "youtube":
        return "bg-red-500/10 text-red-500";

      default:
        return "bg-primary/10 text-primary";
    }
  };

  return (
    <div className="space-y-8 p-4 md:p-6">
      {/* HEADER */}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Platform Connections
          </h1>

          <p className="text-muted-foreground">
            Connect and manage external
            accounts used for publishing,
            syncing and automation.
          </p>
        </div>

        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Connect Platform
        </Button>
      </div>

      {/* STATS */}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Connections
                </p>

                <p className="text-3xl font-bold">
                  {stats.total}
                </p>
              </div>

              <PlugZap className="w-8 h-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Active
                </p>

                <p className="text-3xl font-bold text-green-600">
                  {stats.active}
                </p>
              </div>

              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Expired
                </p>

                <p className="text-3xl font-bold text-orange-500">
                  {stats.expired}
                </p>
              </div>

              <AlertTriangle className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SEARCH */}

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />

        <input
          placeholder="Search connections..."
          value={searchTerm}
          onChange={(e) =>
            setSearchTerm(e.target.value)
          }
          className="w-full h-11 rounded-xl border bg-background pl-10 pr-4"
        />
      </div>

      {/* CONNECTION CARDS */}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredConnections.map(
          (connection) => {
            const expired =
              connection.expiresAt &&
              connection.expiresAt <
                Date.now();

            return (
              <Card
                key={connection._id}
                className="cursor-pointer transition-all hover:shadow-md"
                onClick={() =>
                  setSelectedConnection(
                    connection
                  )
                }
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3">
                      <div
                        className={`w-12 h-12 rounded-xl flex items-center justify-center ${getPlatformColor(
                          connection.platform
                        )}`}
                      >
                        <PlugZap className="w-5 h-5" />
                      </div>

                      <div>
                        <h3 className="font-semibold capitalize">
                          {
                            connection.platform
                          }
                        </h3>

                        <p className="text-sm text-muted-foreground">
                          {
                            connection.accountName
                          }
                        </p>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          Refresh Token
                        </DropdownMenuItem>

                        <DropdownMenuItem>
                          Reconnect
                        </DropdownMenuItem>

                        <DropdownMenuItem className="text-destructive">
                          Disconnect
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <Badge
                      variant={
                        connection.isActive
                          ? "default"
                          : "secondary"
                      }
                    >
                      {expired
                        ? "Expired"
                        : connection.isActive
                        ? "Active"
                        : "Inactive"}
                    </Badge>

                    <span className="text-xs text-muted-foreground">
                      {new Date(
                        connection.connectedAt
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          }
        )}
      </div>

      {/* DETAILS SHEET */}

      <Sheet
        open={!!selectedConnection}
        onOpenChange={() =>
          setSelectedConnection(null)
        }
      >
        <SheetContent className="w-full px-4 sm:max-w-lg overflow-y-auto">
          {selectedConnection && (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">
                  {
                    selectedConnection.platform
                  }
                </SheetTitle>

                <SheetDescription>
                  Connected account details
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                <Card>
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <img 
                        src={selectedConnection.accountAvatarUrl} 
                        alt="" 
                        className="w-20 h-20 rounded-full" 
                      />
                    </div>
                    <Info
                      label="Account Name"
                      value={
                        selectedConnection.accountName
                      }
                    />

                    <Info
                      label="Account ID"
                      value={
                        selectedConnection.accountId
                      }
                    />

                    <Info
                      label="Connected"
                      value={new Date(
                        selectedConnection.connectedAt
                      ).toLocaleString()}
                    />

                    <Info
                      label="Status"
                      value={
                        selectedConnection.isActive
                          ? "Active"
                          : "Inactive"
                      }
                    />
                  </CardContent>
                </Card>

                <div className="grid gap-2">
                  <Button>
                    <RefreshCcw className="w-4 h-4 mr-2" />
                    Refresh Token
                  </Button>

                  <Button variant="outline">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Reconnect Account
                  </Button>

                  <Button variant="destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Disconnect
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

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p className="font-medium">
        {value}
      </p>
    </div>
  );
}
