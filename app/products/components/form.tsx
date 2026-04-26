import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";

interface Product {
  _id: Id<"products">;
  brandId: Id<"brands">;
  shopifyProductId: string;
  title: string;
  description?: string;
  handle: string;
  productType?: string;
  vendor?: string;
  status: string;
  tags: string[];
  imageUrl?: string;
  priceRange?: {
    minPrice: string;
    maxPrice: string;
    currencyCode: string;
  };
  variantCount: number;
  stockCount?: number;
  category?: string;
  syncedAt: number;
}

interface ProductFormData {
  title: string;
  description: string;
  handle: string;
  productType: string;
  vendor: string;
  status: string;
  tags: string[];
  imageUrl: string;
  priceRange?: {
    minPrice: string;
    maxPrice: string;
    currencyCode: string;
  };
  variantCount: number;
  stockCount: string;
  category: string;
}

export default function ProductForm({ 
  isEdit = false, 
  formData, 
  setFormData, 
  setIsCreateDialogOpen, 
  setIsEditDialogOpen, 
  resetForm,
  selectedProduct 
}: {
  isEdit?: boolean;
  formData: ProductFormData;
  setFormData: React.Dispatch<React.SetStateAction<ProductFormData>>;
  setIsCreateDialogOpen: (open: boolean) => void;
  setIsEditDialogOpen: (open: boolean) => void;
  resetForm: () => void;
  selectedProduct: Product | null;
}) {
    const {toast} = useToast();

    const brands = useQuery(api.brands.getBrand);
    const selectedBrand = brands; // getBrand returns a single brand object

      const createProduct = useMutation(api.products.createProduct);
      const updateProduct = useMutation(api.products.updateProduct);

    const handleCreateProduct = async () => {
    if (!selectedBrand) return;

    try {
      await createProduct({
        brandId: selectedBrand._id,
        title: formData.title,
        description: formData.description || undefined,
        handle: formData.handle,
        productType: formData.productType || undefined,
        vendor: formData.vendor || undefined,
        status: formData.status,
        tags: formData.tags,
        imageUrl: formData.imageUrl || undefined,
        priceRange: formData.priceRange,
        variantCount: formData.variantCount,
        stockCount: formData.stockCount ? parseInt(formData.stockCount) : undefined,
        category: formData.category || undefined,
      });

      toast({
        title: "Product created",
        description: "Product has been created successfully.",
      });

      setIsCreateDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create product. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleUpdateProduct = async () => {
    if (!selectedProduct) return;

    try {
      await updateProduct({
        productId: selectedProduct._id,
        title: formData.title,
        description: formData.description || undefined,
        handle: formData.handle,
        productType: formData.productType || undefined,
        vendor: formData.vendor || undefined,
        status: formData.status,
        tags: formData.tags,
        imageUrl: formData.imageUrl || undefined,
        priceRange: formData.priceRange,
        variantCount: formData.variantCount,
        stockCount: formData.stockCount ? parseInt(formData.stockCount) : undefined,
        category: formData.category || undefined,
      });

      toast({
        title: "Product updated",
        description: "Product has been updated successfully.",
      });

      setIsEditDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update product. Please try again.",
        variant: "destructive",
      });
    }
  };
    
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
            <div>
                <Label htmlFor="title">Title *</Label>
                <Input
                key="title"
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Product title"
                />
            </div>
            <div>
                <Label htmlFor="handle">Handle *</Label>
                <Input
                key="handle"
                id="handle"
                value={formData.handle}
                onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
                placeholder="product-handle"
                />
            </div>
            </div>
    
            <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
                key="description"
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Product description"
                rows={3}
            />
            </div>
    
            <div className="grid grid-cols-2 gap-4">
            <div>
                <Label htmlFor="productType">Product Type</Label>
                <Input
                key="productType"
                id="productType"
                value={formData.productType}
                onChange={(e) => setFormData({ ...formData, productType: e.target.value })}
                placeholder="e.g. Clothing, Electronics"
                />
            </div>
            <div>
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                key="vendor"
                id="vendor"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                placeholder="Vendor name"
                />
            </div>
            </div>
    
            <div className="grid grid-cols-2 gap-4">
            <div>
                <Label htmlFor="status">Status</Label>
                <Select key="status" value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
                </Select>
            </div>
            <div>
                <Label htmlFor="category">Category</Label>
                <Input
                key="category"
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="Product category"
                />
            </div>
            </div>
    
            <div className="grid grid-cols-3 gap-4">
            <div>
                <Label htmlFor="minPrice">Min Price</Label>
                <Input
                key="minPrice"
                id="minPrice"
                value={formData.priceRange?.minPrice || ""}
                onChange={(e) => setFormData({
                    ...formData,
                    priceRange: {
                    ...formData.priceRange,
                    minPrice: e.target.value,
                    maxPrice: formData.priceRange?.maxPrice || "",
                    currencyCode: formData.priceRange?.currencyCode || "USD"
                    }
                })}
                placeholder="0.00"
                />
            </div>
            <div>
                <Label htmlFor="maxPrice">Max Price</Label>
                <Input
                key="maxPrice"
                id="maxPrice"
                value={formData.priceRange?.maxPrice || ""}
                onChange={(e) => setFormData({
                    ...formData,
                    priceRange: {
                    ...formData.priceRange,
                    minPrice: formData.priceRange?.minPrice || "",
                    maxPrice: e.target.value,
                    currencyCode: formData.priceRange?.currencyCode || "USD"
                    }
                })}
                placeholder="0.00"
                />
            </div>
            <div>
                <Label htmlFor="stockCount">Stock Count</Label>
                <Input
                key="stockCount"
                id="stockCount"
                type="number"
                value={formData.stockCount}
                onChange={(e) => setFormData({ ...formData, stockCount: e.target.value })}
                placeholder="0"
                />
            </div>
            </div>
    
            <div>
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input
                key="imageUrl"
                id="imageUrl"
                value={formData.imageUrl}
                onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                placeholder="https://example.com/image.jpg"
            />
            </div>
    
            <div>
            <Label>Tags (comma-separated)</Label>
            <Input
                key="tags"
                value={formData.tags.join(", ")}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })}
                placeholder="tag1, tag2, tag3"
            />
            </div>
    
            <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={() => {
                isEdit ? setIsEditDialogOpen(false) : setIsCreateDialogOpen(false);
                resetForm();
            }}>
                Cancel
            </Button>
            <Button onClick={isEdit ? handleUpdateProduct : handleCreateProduct}>
                {isEdit ? "Update Product" : "Create Product"}
            </Button>
            </div>
        </div>
    );
}