'use client';

import { useState } from 'react';
import { Plus, Search, MoreVertical, Mail, User, Calendar } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Id } from '@/convex_/_generated/dataModel';

export default function AmbassadorsPage() {
  const [selectedAmbassador, setSelectedAmbassador] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newAmbassadorName, setNewAmbassadorName] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedNiche, setSelectedNiche] = useState('');
  const [selectedPersonality, setSelectedPersonality] = useState('');

  // Fetch ambassadors and brands
  const ambassadors = useQuery(api.ambassadors.getAllAmbassadors) || [];
  const brands = useQuery(api.brands.getAllBrands) || [];
  const createAmbassador = useMutation(api.ambassadors.createAmbassador);
  const updateAmbassador = useMutation(api.ambassadors.updateAmbassador);
  const deleteAmbassador = useMutation(api.ambassadors.deleteAmbassador);

  const filteredAmbassadors = ambassadors.filter((amb) =>
    amb.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (value: string) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'email',
      label: 'Email',
      render: (value: string) => (
        <a href={`mailto:${value}`} className="text-primary hover:underline text-sm">
          {value}
        </a>
      ),
    },
    {
      key: 'brand',
      label: 'Brand',
      render: (value: any, row: any) => {
        const brand = brands.find(b => b._id === row.brandId);
        return <span className="text-sm">{brand?.name || 'Unknown'}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: any, row: any) => (
        <StatusBadge status={row.isActive ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'niche',
      label: 'Niche',
      render: (value: string) => <span className="font-medium capitalize">{value}</span>,
    },
    {
      key: 'joined',
      label: 'Created',
      render: (value: any, row: any) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
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
            <DropdownMenuItem onClick={() => setSelectedAmbassador(row)}>
              View Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditAmbassador(row)}>Edit Details</DropdownMenuItem>
            <DropdownMenuItem>View Performance</DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDeleteAmbassador(row._id)} 
              className="text-destructive"
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Handler functions
  const handleCreateAmbassador = async () => {
    if (!newAmbassadorName.trim()) {
      toast.error('Please enter an ambassador name');
      return;
    }
    if (!selectedBrandId) {
      toast.error('Please select a brand');
      return;
    }
    if (!selectedNiche) {
      toast.error('Please select a niche');
      return;
    }

    try {
      await createAmbassador({
        name: newAmbassadorName,
        brandId: selectedBrandId as Id<"brands">,
        niche: selectedNiche,
        personality: selectedPersonality || 'Custom',
        type: 'custom',
        category: 'custom',
        isActive: true,
      });
      
      toast.success('Ambassador created successfully!');
      setNewAmbassadorName('');
      setSelectedBrandId('');
      setSelectedNiche('');
      setSelectedPersonality('');
      setIsCreateDialogOpen(false);
    } catch (error) {
      toast.error('Failed to create ambassador');
      console.error(error);
    }
  };

  const handleEditAmbassador = (ambassador: any) => {
    setSelectedAmbassador(ambassador);
    // TODO: Open edit dialog
  };

  const handleDeleteAmbassador = async (ambassadorId: string) => {
    if (confirm('Are you sure you want to remove this ambassador?')) {
      try {
        await deleteAmbassador({ ambassadorId: ambassadorId as Id<"ambassadors"> });
        toast.success('Ambassador removed successfully!');
      } catch (error) {
        toast.error('Failed to remove ambassador');
        console.error(error);
      }
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Ambassadors</h1>
          <p className="text-muted-foreground mt-1">
            Manage brand ambassadors and influencers
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Ambassador
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Ambassador</DialogTitle>
              <DialogDescription>
                Create a new ambassador for a brand
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Ambassador Name</label>
                <input
                  type="text"
                  placeholder="Enter ambassador name"
                  value={newAmbassadorName}
                  onChange={(e) => setNewAmbassadorName(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Brand</label>
                <select 
                  value={selectedBrandId}
                  onChange={(e) => setSelectedBrandId(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select a brand</option>
                  {brands.map((brand) => (
                    <option key={brand._id} value={brand._id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Niche</label>
                <select 
                  value={selectedNiche}
                  onChange={(e) => setSelectedNiche(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select a niche</option>
                  <option value="beauty">Beauty</option>
                  <option value="fashion">Fashion</option>
                  <option value="fitness">Fitness</option>
                  <option value="tech">Tech</option>
                  <option value="lifestyle">Lifestyle</option>
                  <option value="gaming">Gaming</option>
                  <option value="food">Food</option>
                  <option value="travel">Travel</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Personality (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g., Energetic, Sophisticated, Playful"
                  value={selectedPersonality}
                  onChange={(e) => setSelectedPersonality(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <Button 
                onClick={handleCreateAmbassador}
                className="w-full"
                disabled={!newAmbassadorName.trim() || !selectedBrandId || !selectedNiche}
              >
                Create Ambassador
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search ambassadors..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredAmbassadors}
        pageSize={10}
        onRowClick={setSelectedAmbassador}
      />

      {/* Ambassador Details Modal */}
      {selectedAmbassador && (
        <Dialog open={!!selectedAmbassador} onOpenChange={() => setSelectedAmbassador(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedAmbassador.name}</DialogTitle>
              <DialogDescription>
                Ambassador profile and details
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {selectedAmbassador.imageUrl && (
                  <img 
                    src={selectedAmbassador.imageUrl} 
                    alt={selectedAmbassador.name}
                    className="w-16 h-16 object-cover rounded-full"
                  />
                )}
                <div>
                  <p className="text-lg font-semibold">{selectedAmbassador.name}</p>
                  <p className="text-sm text-muted-foreground capitalize">{selectedAmbassador.niche} • {selectedAmbassador.personality}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Brand</p>
                  <p className="text-lg font-semibold mt-1">
                    {brands.find(b => b._id === selectedAmbassador.brandId)?.name || 'Unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="text-lg font-semibold mt-1">
                    <StatusBadge status={selectedAmbassador.isActive ? 'active' : 'inactive'} />
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Type</p>
                  <p className="text-lg font-semibold mt-1 capitalize">{selectedAmbassador.type}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-lg font-semibold mt-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {new Date(selectedAmbassador.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {selectedAmbassador.sampleHook && (
                <div className="bg-secondary p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">Sample Hook</p>
                  <p className="font-medium">{selectedAmbassador.sampleHook}</p>
                </div>
              )}
              {selectedAmbassador.generationTaskId && (
                <div className="bg-secondary p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">Generation Task</p>
                  <p className="font-medium text-xs">{selectedAmbassador.generationTaskId}</p>
                </div>
              )}
            </div>
            <div className="pt-4 border-t border-border flex gap-2 justify-end">
              <Button variant="outline">Edit</Button>
              <Button>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
