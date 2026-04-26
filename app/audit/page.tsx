'use client';

import { Search, Filter } from 'lucide-react';
import { mockAuditLogs } from '@/lib/mock-data';
import { DataTable } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function AuditLogsPage() {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLogs = mockAuditLogs.filter((log) =>
    log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.resource.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'timestamp',
      label: 'Timestamp',
      render: (value: string) => <span className="text-sm font-medium">{value}</span>,
    },
    {
      key: 'user',
      label: 'User',
      render: (value: string) => <span className="text-sm">{value}</span>,
    },
    {
      key: 'action',
      label: 'Action',
      render: (value: string) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'resource',
      label: 'Resource',
      render: (value: string) => <span className="text-sm text-muted-foreground">{value}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">
          Track all system activities and user actions
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <Button variant="outline" className="gap-2">
          <Filter className="w-4 h-4" />
          Filter
        </Button>
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredLogs}
        pageSize={15}
      />
    </div>
  );
}
