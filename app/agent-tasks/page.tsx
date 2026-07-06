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
  Sparkles,
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

export default function AgentTasksPage() {
  const tasks =
    useQuery(api.agentTasks.getAllTasks) ?? [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const brands = useQuery(api.brands.getAllBrands) || [];
  const campaigns = useQuery(api.campaigns.getAllCampaigns, {});


  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const query = searchTerm.toLowerCase();

      return (
        task.agentType?.toLowerCase().includes(query) ||
        task.status?.toLowerCase().includes(query)
      );
    });
  }, [tasks, searchTerm]);

  const handleEditTask = (task: any) => {
    setSelectedTask(task);
  };

  const handleDeleteTask = (taskId: string) => {
    // TODO: Implement delete task
    console.log("Delete task:", taskId);
  };

  const connectedCount = tasks.length;

  const shopifyCount = tasks.filter(
    (t) => t.agentType === "shopify"
  ).length;

  const agentLabels = {
    character_designer: {
        title: "Character Designer",
        icon: Sparkles,
    },
    };

//   const columns = [
//     {
//     key: "agentType",
//     label: "Agent",
//     render: (value: string) => {
//         const agent = agentLabels[value as keyof typeof agentLabels];

//         return (
//         <div className="flex items-center gap-3">
//             <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
//             <Sparkles className="w-4 h-4" />
//             </div>

//             <div>
//                 <p className="font-medium">
//                     {agent?.title ?? value}
//                 </p>

//                 <p className="text-xs text-muted-foreground">
//                     AI Specialized Agent
//                 </p>
//             </div>
//         </div>
//         );
//     },
//     }
//   ];

//   const campaigns = useQuery(api.campaigns.getAllCampaigns, {});

      const columns = [
        {
            key: 'brand',
            label: 'Brand',
            render: (value: any, row: any) => {
                const brand = brands.find(b => b._id === row.brandId);
                return <span className="text-sm">{brand?.name || 'Unknown'}</span>;
            },
        },
        
        // {
        //   key: 'status',
        //   label: 'Status',
        //   render: (value: string) => <StatusBadge status={value} />,
        // },
        {
          key: 'agentType',
          label: 'Agent Type',
          render: (value: string) => (
            <span className="text-sm capitalize px-2 py-1 bg-secondary rounded">
              {value}
            </span>
          ),
        },
        {
          key: 'angleId',
          label: 'Brand Name',
          render: (value: string) => <span className="font-medium">{value}</span>,
        },
        {
          key: 'campaign',
          label: 'Campaigns',
        //   render: (value: number) => <span className="font-medium">{value}</span>,
        render: (value: any, row: any) => {
            const campaign = campaigns?.find(b => b._id === row.campaignId);
            return <span className="text-sm">{campaign?.name || 'Unknown'}</span>;
        },
        },
        {
          key: 'status',
          label: 'Status',
          render: (value: string) => <span className="font-medium text-green-400">{value}</span>,
        },
        {
          key: 'lastActive',
          label: 'Last Active',
          render: (value: string) => <span className="text-sm text-muted-foreground">{value}</span>,
        },
        {
          key: 'actions',
          label: 'Actions',
          render: (value: any, row: any) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSelectedTask(row)}>
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleEditTask(row)}>Edit Task</DropdownMenuItem>
                <DropdownMenuItem>View Campaigns</DropdownMenuItem>
                <DropdownMenuItem>View Ambassadors</DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => handleDeleteTask(row._id)} 
                  className="text-destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
      ];


  const statusConfig = {
    pending: {
        label: "Pending",
        className:
        "bg-amber-500/10 text-amber-600 border-amber-500/20",
    },

    running: {
        label: "Running",
        className:
        "bg-blue-500/10 text-blue-600 border-blue-500/20",
    },

    completed: {
        label: "Completed",
        className:
        "bg-green-500/10 text-green-600 border-green-500/20",
    },

    failed: {
        label: "Failed",
        className:
        "bg-red-500/10 text-red-600 border-red-500/20",
    },
    };

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            Agent Tasks
          </h1>

          <p className="text-muted-foreground mt-1">
            Monitor and manage AI agent tasks.
          </p>
        </div>

        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Add Task
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
        data={filteredTasks}
        pageSize={10}
        onRowClick={setSelectedTask}
      />


        <Sheet
            open={!!selectedTask}
            onOpenChange={() => setSelectedTask(null)}
        >
            <SheetContent
                side="right"
                className="w-full sm:max-w-xl px-4 overflow-y-auto"
            >
                {selectedTask && (
                <>
                    <SheetHeader className="pb-6">
                    <SheetTitle className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Sparkles className="w-5 h-5" />
                        </div>

                        <div>
                        <p className="capitalize font-semibold">
                            {selectedTask.label || selectedTask.agentType}
                        </p>

                        <p className="text-sm font-normal text-muted-foreground">
                            {selectedTask.status}
                        </p>
                        </div>
                    </SheetTitle>

                    <SheetDescription>
                        Task details, input configuration, and output summary.
                    </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Task Details</CardTitle>
                                <CardDescription>Essential metadata for this agent task.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Info label="Task ID" value={selectedTask._id} />
                                <Info label="Created" value={new Date(selectedTask.createdAt).toLocaleString()} />
                                <Info label="Created (Convex)" value={new Date(selectedTask._creationTime).toLocaleString()} />
                                <Info label="Updated" value={new Date(selectedTask.updatedAt).toLocaleString()} />
                                <Info label="Agent Type" value={selectedTask.agentType} />
                                <Info label="Label" value={selectedTask.label} />
                                <Info label="Status" value={selectedTask.status} />
                                <Info label="Initiated From" value={selectedTask.initiatedFrom} />
                                <Info label="Brand ID" value={selectedTask.brandId} />
                                <Info label="Campaign ID" value={selectedTask.campaignId} />
                                <Info label="Angle ID" value={selectedTask.angleId} />
                                <Info label="falRequestId" value={selectedTask.falRequestId} />
                                <Info label="User ID" value={selectedTask.userId} />
                            </CardContent>
                        </Card>

                        {selectedTask.input && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Input</CardTitle>
                                <CardDescription>Prompt, settings, and resolved input assets.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Info label="Brand Name" value={selectedTask.input.brandName} />
                                <Info label="Aspect Ratio" value={selectedTask.input.aspectRatio} />
                                <Info label="Duration" value={selectedTask.input.duration} />
                                <Info label="Generate Audio" value={String(selectedTask.input.generateAudio)} />
                                {selectedTask.input.videoStyle && <Info label="Video Style" value={selectedTask.input.videoStyle} />}
                                {selectedTask.input.resolvedModel && <Info label="Model" value={selectedTask.input.resolvedModel} />}
                                {selectedTask.input.resolvedStartImageUrl && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Start Image</p>
                                        <img
                                            src={selectedTask.input.resolvedStartImageUrl}
                                            alt="Resolved Start"
                                            className="mt-2 w-full rounded-lg border border-border object-cover"
                                        />
                                    </div>
                                )}
                                {selectedTask.input.resolvedElements && selectedTask.input.resolvedElements.length > 0 && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Resolved Elements</p>
                                        <div className="mt-2 grid gap-3">
                                            {selectedTask.input.resolvedElements.map((element: any, idx: number) => (
                                                <div key={idx} className="rounded-lg border border-border p-3 bg-muted">
                                                    <p className="font-medium">Element {idx + 1}</p>
                                                    <p className="text-sm text-muted-foreground">frontal image url</p>
                                                    <a href={element.frontal_image_url} target="_blank" rel="noreferrer" className="text-primary underline break-all">
                                                        {element.frontal_image_url}
                                                    </a>
                                                    {element.reference_image_urls && (
                                                        <div className="mt-2 space-y-1">
                                                            <p className="text-sm text-muted-foreground">Reference URLs</p>
                                                            {element.reference_image_urls.map((url: string, urlIndex: number) => (
                                                                <a key={urlIndex} href={url} target="_blank" rel="noreferrer" className="text-primary underline block break-all">
                                                                    {url}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {selectedTask.input.prompt && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Prompt</p>
                                        <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto max-h-40">
                                            {selectedTask.input.prompt}
                                        </pre>
                                    </div>
                                )}
                                {selectedTask.input.builtPrompt && (
                                    <div>
                                        <p className="text-xs text-muted-foreground">Built Prompt</p>
                                        <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto max-h-40">
                                            {selectedTask.input.builtPrompt}
                                        </pre>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        )}

                        {selectedTask.output && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Output</CardTitle>
                                <CardDescription>Generated media and related metadata.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {selectedTask.output.thumbnailUrl && (
                                    <img
                                        src={selectedTask.output.thumbnailUrl}
                                        alt="Output thumbnail"
                                        className="w-full rounded-lg border border-border object-cover"
                                    />
                                )}
                                <Info label="Video URL" value={selectedTask.output.videoUrl} />
                                <Info label="Thumbnail URL" value={selectedTask.output.thumbnailUrl} />
                                <Info label="Generated At" value={selectedTask.output.generatedAt ? new Date(selectedTask.output.generatedAt).toLocaleString() : "N/A"} />
                                <Info label="Model" value={selectedTask.output.model} />
                                <Info label="Prompt" value={selectedTask.output.prompt} />
                                {selectedTask.output._original_videoUrl && (
                                    <Info label="Original Video URL" value={selectedTask.output._original_videoUrl} />
                                )}
                                {selectedTask.output._original_thumbnailUrl && (
                                    <Info label="Original Thumbnail URL" value={selectedTask.output._original_thumbnailUrl} />
                                )}
                                {selectedTask.output._r2Status && <Info label="R2 Status" value={selectedTask.output._r2Status} />}
                            </CardContent>
                        </Card>
                        )}

                        <div className="sticky bottom-0 bg-background pt-4 border-t">
                            <div className="flex gap-2">
                            <Button className="flex-1">
                                <RefreshCcw className="w-4 h-4 mr-2" />
                                Refresh
                            </Button>

                            <Button
                                variant="outline"
                                className="flex-1"
                            >
                                Copy ID
                            </Button>
                            </div>

                            <Button
                            variant="destructive"
                            className="w-full mt-2"
                            >
                            Close
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
