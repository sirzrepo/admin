'use client';

import { useState } from 'react';
import { Search, MoreVertical, RefreshCw, Trash2 } from 'lucide-react';
import { mockGenerationQueue } from '@/lib/mock-data';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function GenerationPage() {
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredQueue = mockGenerationQueue.filter((item) =>
    item.campaign.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'campaign',
      label: 'Campaign',
      render: (value: string) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      render: (value: string) => (
        <span className="text-sm px-2 py-1 bg-secondary rounded capitalize">
          {value.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'provider',
      label: 'Provider',
      render: (value: string) => <span className="text-sm font-medium">{value}</span>,
    },
    {
      key: 'tokens',
      label: 'Tokens',
      render: (value: number) => <span className="font-medium text-muted-foreground">{value.toLocaleString()}</span>,
    },
    {
      key: 'cost',
      label: 'Cost',
      render: (value: string) => <span className="font-semibold text-yellow-400">{value}</span>,
    },
    {
      key: 'queuedAt',
      label: 'Queued At',
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
            <DropdownMenuItem onClick={() => setSelectedItem(row)}>
              View Details
            </DropdownMenuItem>
            {row.status === 'queued' && (
              <DropdownMenuItem className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Retry
              </DropdownMenuItem>
            )}
            {row.status === 'processing' && (
              <DropdownMenuItem>Cancel</DropdownMenuItem>
            )}
            {row.status !== 'processing' && (
              <DropdownMenuItem className="text-destructive flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const stats = {
    processing: mockGenerationQueue.filter(i => i.status === 'processing').length,
    queued: mockGenerationQueue.filter(i => i.status === 'queued').length,
    completed: mockGenerationQueue.filter(i => i.status === 'completed').length,
    failed: mockGenerationQueue.filter(i => i.status === 'failed').length,
    totalCost: '$' + mockGenerationQueue.reduce((sum, i) => {
      const cost = parseFloat(i.cost.replace('$', ''));
      return sum + cost;
    }, 0).toFixed(2),
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">AI Generation Queue</h1>
        <p className="text-muted-foreground mt-1">
          Monitor and manage AI content generation jobs
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Processing</p>
          <p className="text-2xl font-bold mt-2 text-blue-400">{stats.processing}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Queued</p>
          <p className="text-2xl font-bold mt-2 text-purple-400">{stats.queued}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Completed</p>
          <p className="text-2xl font-bold mt-2 text-green-400">{stats.completed}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Failed</p>
          <p className="text-2xl font-bold mt-2 text-red-400">{stats.failed}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Total Cost</p>
          <p className="text-2xl font-bold mt-2 text-yellow-400">{stats.totalCost}</p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search generation queue..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredQueue}
        pageSize={10}
        onRowClick={setSelectedItem}
      />

      {/* Generation Details Modal */}
      {selectedItem && (
        <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Generation Details</DialogTitle>
              <DialogDescription>
                Information about this generation job
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Campaign</p>
                  <p className="text-lg font-semibold mt-1">{selectedItem.campaign}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <p className="text-lg font-semibold mt-1 capitalize">
                    {selectedItem.type.replace(/_/g, ' ')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="text-lg font-semibold mt-1">
                    <StatusBadge status={selectedItem.status} />
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Provider</p>
                  <p className="text-lg font-semibold mt-1">{selectedItem.provider}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tokens Used</p>
                  <p className="text-lg font-semibold mt-1">{selectedItem.tokens.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cost</p>
                  <p className="text-lg font-semibold mt-1 text-yellow-400">{selectedItem.cost}</p>
                </div>
              </div>
              <div className="bg-secondary p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-2">Timeline</p>
                <div className="space-y-2 text-sm">
                  <p className="font-semibold">Queued: <span className="text-muted-foreground">{selectedItem.queuedAt}</span></p>
                  {selectedItem.completedAt && (
                    <p className="font-semibold">Completed: <span className="text-muted-foreground">{selectedItem.completedAt}</span></p>
                  )}
                </div>
              </div>
            </div>
            <div className="pt-4 border-t border-border flex gap-2 justify-end">
              <Button variant="outline">Close</Button>
              {selectedItem.status === 'queued' && (
                <Button className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
