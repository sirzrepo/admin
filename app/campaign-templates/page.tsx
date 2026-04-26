'use client';

import { useState } from 'react';
import { Search, Plus, Sparkles, LayoutTemplateIcon, Filter, Eye, Edit, Trash2, MoreVertical } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '@/convex_/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export default function CampaignTemplatesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  
  // Form states
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    description: '',
    industries: [] as string[],
    sampleHooks: [] as string[],
    suggestedAngles: [] as string[],
    suggestedTypes: [] as string[],
    source: '',
    isActive: true,
  });

  // Fetch data
  const campaignTemplates = useQuery(api.campaignTemplates.getCampaignTemplates, {}) || [];
  const createTemplate = useMutation(api.campaignTemplates.createCampaignTemplate);
  const updateTemplate = useMutation(api.campaignTemplates.updateCampaignTemplate);
  const deleteTemplate = useMutation(api.campaignTemplates.deleteCampaignTemplate);

  // Get unique categories and industries for filters
  const categories = Array.from(new Set(campaignTemplates.map(t => t.category)));
  const industries = Array.from(new Set(campaignTemplates.flatMap(t => t.industries)));

  // Filter templates
  const filteredTemplates = campaignTemplates.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    const matchesIndustry = selectedIndustry === 'all' || template.industries.includes(selectedIndustry);
    
    return matchesSearch && matchesCategory && matchesIndustry;
  });

  // Handler functions
  const handleCreateTemplate = async () => {
    if (!formData.name.trim() || !formData.category.trim() || !formData.description.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      await createTemplate({
        name: formData.name,
        category: formData.category,
        description: formData.description,
        industries: formData.industries,
        sampleHooks: formData.sampleHooks,
        suggestedAngles: formData.suggestedAngles,
        suggestedTypes: formData.suggestedTypes,
        source: formData.source,
        isActive: formData.isActive,
      });
      
      toast.success('Template created successfully!');
      resetForm();
      setIsCreateDialogOpen(false);
    } catch (error) {
      toast.error('Failed to create template');
      console.error(error);
    }
  };

  const handleUpdateTemplate = async () => {
    if (!selectedTemplate) return;
    
    try {
      await updateTemplate({
        templateId: selectedTemplate._id,
        name: formData.name,
        category: formData.category,
        description: formData.description,
        industries: formData.industries,
        sampleHooks: formData.sampleHooks,
        suggestedAngles: formData.suggestedAngles,
        suggestedTypes: formData.suggestedTypes,
        isActive: formData.isActive,
      });
      
      toast.success('Template updated successfully!');
      resetForm();
      setIsEditDialogOpen(false);
      setSelectedTemplate(null);
    } catch (error) {
      toast.error('Failed to update template');
      console.error(error);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (confirm('Are you sure you want to delete this template?')) {
      try {
        await deleteTemplate({ templateId: templateId as Id<"campaignTemplates"> });
        toast.success('Template deleted successfully!');
      } catch (error) {
        toast.error('Failed to delete template');
        console.error(error);
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: '',
      description: '',
      industries: [],
      sampleHooks: [],
      suggestedAngles: [],
      suggestedTypes: [],
      source: '',
      isActive: true,
    });
  };

  const openEditDialog = (template: any) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      category: template.category,
      description: template.description,
      industries: template.industries,
      sampleHooks: template.sampleHooks,
      suggestedAngles: template.suggestedAngles,
      suggestedTypes: template.suggestedTypes,
      source: template.source,
      isActive: template.isActive,
    });
    setIsEditDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Campaign Templates</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage campaign templates for your marketing campaigns
          </p>
        </div>
        <Button 
          className="gap-2" 
          onClick={() => setIsCreateDialogOpen(true)}
        >
          <Plus className="w-4 h-4" />
          Create Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedIndustry} onValueChange={setSelectedIndustry}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {industries.map((industry) => (
              <SelectItem key={industry} value={industry}>
                {industry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => (
          <Card key={template._id} className="group hover:shadow-lg transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg group-hover:text-primary transition-colors">
                    {template.name}
                  </CardTitle>
                  <CardDescription className="mt-1 line-clamp-2">
                    {template.description}
                  </CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem 
                      onClick={() => {
                        setSelectedTemplate(template);
                        setIsCreateDialogOpen(true);
                      }}
                    >
                      Create Campaign
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      View Details
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{template.category}</Badge>
                    {!template.isActive && (
                      <Badge variant="destructive" className="text-xs">Inactive</Badge>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(template)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit Template
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Eye className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDeleteTemplate(template._id)}
                        className="text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Template
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="w-3 h-3" />
                  <span>Used {template.usageCount} times</span>
                </div>
                
                <div className="flex flex-wrap gap-1">
                  {template.industries.slice(0, 3).map((industry: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {industry}
                    </Badge>
                  ))}
                  {template.industries.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{template.industries.length - 3}
                    </Badge>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Sample Hooks:</p>
                  <div className="space-y-1">
                    {template.sampleHooks.slice(0, 2).map((hook: string, idx: number) => (
                      <p key={idx} className="text-xs text-muted-foreground italic line-clamp-1">
                        "{hook}"
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {filteredTemplates.length === 0 && (
        <div className="text-center py-12">
          <LayoutTemplateIcon className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No templates found</h3>
          <p className="text-muted-foreground">
            Try adjusting your search or filters to find what you're looking for.
          </p>
        </div>
      )}

      {/* Create Template Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Campaign Template</DialogTitle>
            <DialogDescription>
              Create a new template for marketing campaigns
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Template Name *</label>
                <Input
                  type="text"
                  placeholder="Enter template name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Category *</label>
                <Input
                  type="text"
                  placeholder="e.g., Product Launch, Seasonal, Brand Awareness"
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Description *</label>
                <Textarea
                  placeholder="Describe what this template is for..."
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="min-h-[80px]"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Source</label>
                <Input
                  type="text"
                  placeholder="Where did this template come from?"
                  value={formData.source}
                  onChange={(e) => setFormData({...formData, source: e.target.value})}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleCreateTemplate}
                disabled={!formData.name.trim() || !formData.category.trim() || !formData.description.trim()}
              >
                Create Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Campaign Template</DialogTitle>
            <DialogDescription>
              Update the template details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Template Name *</label>
                <Input
                  type="text"
                  placeholder="Enter template name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Category *</label>
                <Input
                  type="text"
                  placeholder="e.g., Product Launch, Seasonal, Brand Awareness"
                  value={formData.category}
                  onChange={(e) => setFormData({...formData, category: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Description *</label>
                <Textarea
                  placeholder="Describe what this template is for..."
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="min-h-[80px]"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Source</label>
                <Input
                  type="text"
                  placeholder="Where did this template come from?"
                  value={formData.source}
                  onChange={(e) => setFormData({...formData, source: e.target.value})}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                />
                <label htmlFor="isActive" className="text-sm font-medium">
                  Template is active
                </label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleUpdateTemplate}
                disabled={!formData.name.trim() || !formData.category.trim() || !formData.description.trim()}
              >
                Update Template
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}