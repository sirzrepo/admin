'use client';

import { useState } from 'react';
import { Plus, Search, MoreVertical, Calendar, Sparkles, LayoutTemplateIcon } from 'lucide-react';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Id } from '@/convex_/_generated/dataModel';

export default function CampaignsPage() {
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignDescription, setNewCampaignDescription] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<any[]>([]);

  // Fetch campaigns, brands, and templates
  const campaigns = useQuery(api.campaigns.getCampaigns) || [];
  const brands = useQuery(api.brands.getAllBrands) || [];
  const campaignTemplates = useQuery(api.campaignTemplates.getCampaignTemplates, { activeOnly: true }) || [];
  const createCampaign = useMutation(api.campaigns.createCampaign);
  const createCampaignFromTemplate = useMutation(api.campaignTemplates.createCampaignFromTemplate);
  const updateCampaign = useMutation(api.campaigns.updateCampaign);
  const deleteCampaign = useMutation(api.campaigns.deleteCampaign);

  const filteredCampaigns = campaigns.filter((camp) =>
    camp.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: 'name',
      label: 'Campaign Name',
      render: (value: string) => <span className="font-medium">{value}</span>,
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
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'progress',
      label: 'Progress',
      render: (value: number) => (
        <div className="flex items-center gap-2">
          <div className="w-24 bg-secondary rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${value}%` }}
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground">{value}%</span>
        </div>
      ),
    },
    {
      key: 'kits',
      label: 'Products',
      render: (value: any) => <span className="font-medium">{value?.length || 0}</span>,
    },
    {
      key: 'deadline',
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
            <DropdownMenuItem onClick={() => setSelectedCampaign(row)}>
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditCampaign(row)}>Edit Campaign</DropdownMenuItem>
            <DropdownMenuItem>View Products</DropdownMenuItem>
            <DropdownMenuItem>View Analytics</DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleDeleteCampaign(row._id)} 
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
  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) {
      toast.error('Please enter a campaign name');
      return;
    }
    if (!selectedBrandId) {
      toast.error('Please select a brand');
      return;
    }

    try {
      await createCampaign({
        name: newCampaignName,
        description: newCampaignDescription,
        brandId: selectedBrandId as Id<"brands">,
        campaignType: 'from_scratch',
      });
      
      toast.success('Campaign created successfully!');
      setNewCampaignName('');
      setNewCampaignDescription('');
      setSelectedBrandId('');
      setIsCreateDialogOpen(false);
    } catch (error) {
      toast.error('Failed to create campaign');
      console.error(error);
    }
  };

  const handleCreateCampaignFromTemplate = async () => {
    if (!selectedTemplateId) {
      toast.error('Please select a template');
      return;
    }
    if (!selectedBrandId) {
      toast.error('Please select a brand');
      return;
    }
    if (!newCampaignName.trim()) {
      toast.error('Please enter a campaign name');
      return;
    }

    try {
      await createCampaignFromTemplate({
        templateId: selectedTemplateId as Id<"campaignTemplates">,
        brandId: selectedBrandId as Id<"brands">,
        customName: newCampaignName,
        selectedProducts: selectedProducts,
      });
      
      toast.success('Campaign created from template successfully!');
      setNewCampaignName('');
      setSelectedBrandId('');
      setSelectedTemplateId('');
      setSelectedProducts([]);
      setIsTemplateDialogOpen(false);
    } catch (error) {
      toast.error('Failed to create campaign from template');
      console.error(error);
    }
  };

  const handleEditCampaign = (campaign: any) => {
    setSelectedCampaign(campaign);
    // TODO: Open edit dialog
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (confirm('Are you sure you want to delete this campaign?')) {
      try {
        await deleteCampaign({ campaignId: campaignId as Id<"campaigns"> });
        toast.success('Campaign deleted successfully!');
      } catch (error) {
        toast.error('Failed to delete campaign');
        console.error(error);
      }
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Campaign Kits</h1>
          <p className="text-muted-foreground mt-1">
            Manage marketing campaigns and content kits
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <LayoutTemplateIcon className="w-4 h-4" />
                Create from Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Campaign from Template</DialogTitle>
                <DialogDescription>
                  Start with a pre-designed campaign template
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Campaign Name</label>
                    <input
                      type="text"
                      placeholder="Enter campaign name"
                      value={newCampaignName}
                      onChange={(e) => setNewCampaignName(e.target.value)}
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
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-3 block">Choose Template</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {campaignTemplates.map((template) => (
                      <Card 
                        key={template._id}
                        className={`cursor-pointer transition-all ${
                          selectedTemplateId === template._id 
                            ? 'ring-2 ring-primary bg-primary/5' 
                            : 'hover:bg-secondary/50'
                        }`}
                        onClick={() => setSelectedTemplateId(template._id)}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            <Badge variant="secondary">{template.category}</Badge>
                          </div>
                          <CardDescription>{template.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1">
                              {template.suggestedAngles.slice(0, 3).map((angle: string, idx: number) => (
                                <Badge key={idx} variant="outline" className="text-xs">
                                  {angle}
                                </Badge>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Sparkles className="w-3 h-3" />
                              <span>Used {template.usageCount} times</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
                
                {selectedTemplateId && (
                  <div>
                    <label className="text-sm font-medium mb-3 block">Template Details</label>
                    {(() => {
                      const template = campaignTemplates.find(t => t._id === selectedTemplateId);
                      if (!template) return null;
                      return (
                        <Card>
                          <CardContent className="pt-4">
                            <div className="space-y-4">
                              <div>
                                <p className="text-sm font-medium mb-2">Sample Hooks</p>
                                <div className="space-y-1">
                                  {template.sampleHooks.map((hook: string, idx: number) => (
                                    <p key={idx} className="text-sm text-muted-foreground italic">"{hook}"</p>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="text-sm font-medium mb-2">Suggested Campaign Types</p>
                                <div className="flex flex-wrap gap-1">
                                  {template.suggestedTypes.map((type: string, idx: number) => (
                                    <Badge key={idx} variant="outline">{type}</Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })()}
                  </div>
                )}
                
                <Button 
                  onClick={handleCreateCampaignFromTemplate}
                  className="w-full"
                  disabled={!newCampaignName.trim() || !selectedBrandId || !selectedTemplateId}
                >
                  Create Campaign from Template
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                New Campaign
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>
                Start a new marketing campaign
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Campaign Name</label>
                <input
                  type="text"
                  placeholder="Enter campaign name"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Description (Optional)</label>
                <textarea
                  placeholder="Campaign description"
                  value={newCampaignDescription}
                  onChange={(e) => setNewCampaignDescription(e.target.value)}
                  className="w-full px-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
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
              <Button 
                onClick={handleCreateCampaign}
                className="w-full"
                disabled={!newCampaignName.trim() || !selectedBrandId}
              >
                Create Campaign
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search campaigns..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-input text-foreground rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredCampaigns}
        pageSize={10}
        onRowClick={setSelectedCampaign}
      />

      {/* Campaign Details Modal */}
      {selectedCampaign && (
        <Dialog open={!!selectedCampaign} onOpenChange={() => setSelectedCampaign(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedCampaign.name}</DialogTitle>
              <DialogDescription>
                Campaign details and metrics
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Brand</p>
                  <p className="text-lg font-semibold mt-1">
                    {brands.find(b => b._id === selectedCampaign.brandId)?.name || 'Unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="text-lg font-semibold mt-1">
                    <StatusBadge status={selectedCampaign.status} />
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Products</p>
                  <p className="text-lg font-semibold mt-1">{selectedCampaign.products?.length || 0}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-lg font-semibold mt-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {new Date(selectedCampaign.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {selectedCampaign.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="text-lg font-semibold mt-1">{selectedCampaign.description}</p>
                </div>
              )}
              <div className="bg-secondary p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">Campaign Progress</p>
                  <span className="text-lg font-semibold">{selectedCampaign.progress}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${selectedCampaign.progress}%` }}
                  />
                </div>
              </div>
              {selectedCampaign.products && selectedCampaign.products.length > 0 && (
                <div className="border-t border-border pt-4">
                  <p className="text-sm text-muted-foreground mb-3">Products ({selectedCampaign.products.length})</p>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedCampaign.products.map((product: any, index: number) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-secondary rounded-lg">
                        {product.imageUrl && (
                          <img 
                            src={product.imageUrl} 
                            alt={product.name}
                            className="w-12 h-12 object-cover rounded"
                          />
                        )}
                        <div className="flex-1">
                          <p className="font-medium">{product.name}</p>
                          {product.targetAudience && (
                            <p className="text-sm text-muted-foreground">{product.targetAudience}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
