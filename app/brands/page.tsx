'use client';

import { useState } from 'react';
import { Plus, Search, MoreVertical, Edit, Trash2 } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
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

export default function BrandsPage() {
  const brandsData = useQuery(api.brands.getAllBrands);
  const [selectedBrand, setSelectedBrand] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandTagline, setNewBrandTagline] = useState('');
  const [editBrandName, setEditBrandName] = useState('');
  const [editBrandTagline, setEditBrandTagline] = useState('');

  // Mutations
  const createBrand = useMutation(api.brands.createBrand);
  const updateBrand = useMutation(api.brands.updateBrand);
  const deleteBrand = useMutation(api.brands.deleteBrand);

  // Transform Convex data to match UI schema with dummy values
  const transformBrandData = (brand: any) => ({
    ...brand,
    // Add dummy fields that aren't in Convex schema
    tier: 'Professional', // Dummy value
    ambassadors: 0, // Dummy value
    campaigns: 0, // Dummy value
    revenue: '$0', // Dummy value
    lastActive: 'Never', // Dummy value
  });

  // Transform array of brands
  const allBrands = brandsData 
    ? brandsData.map((brand: any) => transformBrandData(brand))
    : [];

  const filteredBrands = allBrands.filter((brand: any) =>
    brand.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'name',
      label: 'Brand Name',
      render: (value: string) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'tier',
      label: 'Tier',
      render: (value: string) => (
        <span className="text-sm capitalize px-2 py-1 bg-secondary rounded">
          {value}
        </span>
      ),
    },
    {
      key: 'ambassadors',
      label: 'Ambassadors',
      render: (value: number) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'campaigns',
      label: 'Campaigns',
      render: (value: number) => <span className="font-medium">{value}</span>,
    },
    {
      key: 'revenue',
      label: 'Revenue',
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
            <DropdownMenuItem onClick={() => setSelectedBrand(row)}>
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditBrand(row)}>Edit Brand</DropdownMenuItem>
            <DropdownMenuItem>View Campaigns</DropdownMenuItem>
            <DropdownMenuItem>View Ambassadors</DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDeleteBrand(row._id)} 
              className="text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Handler functions
  const handleCreateBrand = async () => {
    if (!newBrandName.trim()) {
      toast.error('Please enter a brand name');
      return;
    }

    try {
      await createBrand({
        name: newBrandName,
        tagline: newBrandTagline,
      });
      
      toast.success('Brand created successfully!');
      setNewBrandName('');
      setNewBrandTagline('');
      setIsCreateDialogOpen(false);
    } catch (error) {
      toast.error('Failed to create brand');
      console.error(error);
    }
  };

  const handleEditBrand = (brand: any) => {
    setSelectedBrand(brand);
    setEditBrandName(brand.name);
    setEditBrandTagline(brand.tagline || '');
    setIsEditDialogOpen(true);
  };

  const handleUpdateBrand = async () => {
    if (!editBrandName.trim()) {
      toast.error('Please enter a brand name');
      return;
    }

    try {
      await updateBrand({
        brandId: selectedBrand._id as Id<"brands">,
        name: editBrandName,
        tagline: editBrandTagline,
      });
      
      toast.success('Brand updated successfully!');
      setEditBrandName('');
      setEditBrandTagline('');
      setIsEditDialogOpen(false);
      setSelectedBrand(null);
    } catch (error) {
      toast.error('Failed to update brand');
      console.error(error);
    }
  };

  const handleDeleteBrand = async (brandId: string) => {
    if (confirm('Are you sure you want to delete this brand? This action cannot be undone.')) {
      try {
        await deleteBrand({ brandId: brandId as Id<"brands"> });
        toast.success('Brand deleted successfully!');
      } catch (error) {
        toast.error('Failed to delete brand');
        console.error(error);
      }
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Brands</h1>
          <p className="text-muted-foreground mt-1">
            Manage all brands and their campaigns
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Brand
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Brand</DialogTitle>
              <DialogDescription>
                Add a new brand to the platform
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Brand Name</label>
                <input
                  type="text"
                  placeholder="Enter brand name"
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Tagline (Optional)</label>
                <input
                  type="text"
                  placeholder="Enter brand tagline"
                  value={newBrandTagline}
                  onChange={(e) => setNewBrandTagline(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <Button 
                onClick={handleCreateBrand}
                className="w-full"
                disabled={!newBrandName.trim()}
              >
                Create Brand
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
          placeholder="Search brands..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredBrands}
        pageSize={10}
        onRowClick={setSelectedBrand}
      />

      {/* Brand Details Modal */}
      {selectedBrand && (
        <Dialog open={!!selectedBrand} onOpenChange={() => setSelectedBrand(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedBrand.name}</DialogTitle>
              <DialogDescription>
                Brand details and information
              </DialogDescription>
            </DialogHeader>
            
            {/* Cover Image */}
            {selectedBrand.coverImageUrl && (
              <div className="w-full h-48 rounded-lg overflow-hidden bg-secondary">
                <img 
                  src={selectedBrand.coverImageUrl} 
                  alt={`${selectedBrand.name} cover`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback if image fails to load
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="text-lg font-semibold mt-1">
                  <StatusBadge status={selectedBrand.status} />
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tier</p>
                <p className="text-lg font-semibold mt-1 capitalize">{selectedBrand.tier}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ambassadors</p>
                <p className="text-lg font-semibold mt-1">{selectedBrand.ambassadors}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Campaigns</p>
                <p className="text-lg font-semibold mt-1">{selectedBrand.campaigns}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-lg font-semibold mt-1 text-green-400">
                  {selectedBrand.revenue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Active</p>
                <p className="text-lg font-semibold mt-1">{selectedBrand.lastActive}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-border flex gap-2 justify-end">
              <Button variant="outline">Edit</Button>
              <Button>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Brand Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>
              Update brand information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Brand Name</label>
              <input
                type="text"
                placeholder="Enter brand name"
                value={editBrandName}
                onChange={(e) => setEditBrandName(e.target.value)}
                className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Tagline (Optional)</label>
              <input
                type="text"
                placeholder="Enter brand tagline"
                value={editBrandTagline}
                onChange={(e) => setEditBrandTagline(e.target.value)}
                className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <Button 
              onClick={handleUpdateBrand}
              className="w-full"
              disabled={!editBrandName.trim()}
            >
              Update Brand
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
