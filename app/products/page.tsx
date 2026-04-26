"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Search, Package, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import ProductForm from "./components/form";

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

export default function ProductsPage() {
//   const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  // Form data
  const [formData, setFormData] = useState<ProductFormData>({
    title: "",
    description: "",
    handle: "",
    productType: "",
    vendor: "",
    status: "ACTIVE",
    tags: [],
    imageUrl: "",
    variantCount: 1,
    stockCount: "",
    category: "",
  });

  // Queries
   const currentUser = useQuery(api.users.getMe);
  const brands = useQuery(api.brands.getBrand);
  const selectedBrand = brands; // getBrand returns a single brand object
  const products = useQuery(
    api.products.listProducts,
    selectedBrand ? { brandId: selectedBrand._id, paginationOpts: { numItems: 100, cursor: null } } : "skip"
  );

  

  // Mutations
  const createProduct = useMutation(api.products.createProduct);
  const updateProduct = useMutation(api.products.updateProduct);
  const deleteProduct = useMutation(api.products.deleteProductMutation);

  // Filter products based on search and tab
  const filteredProducts = products?.page.filter(product => {
    const matchesSearch = product.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.handle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesTab = activeTab === "all" || 
                      (activeTab === "active" && product.status === "ACTIVE") ||
                      (activeTab === "draft" && product.status === "DRAFT") ||
                      (activeTab === "archived" && product.status === "ARCHIVED");
    
    return matchesSearch && matchesTab;
  }) || [];

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
      setSelectedProduct(null);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update product. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteProduct = async (productId: Id<"products">) => {
    try {
      await deleteProduct({ productId });

      toast({
        title: "Product deleted",
        description: "Product has been deleted successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete product. Please try again.",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (product: Product) => {
    setSelectedProduct(product);
    setFormData({
      title: product.title,
      description: product.description || "",
      handle: product.handle,
      productType: product.productType || "",
      vendor: product.vendor || "",
      status: product.status,
      tags: product.tags,
      imageUrl: product.imageUrl || "",
      priceRange: product.priceRange,
      variantCount: product.variantCount,
      stockCount: product.stockCount?.toString() || "",
      category: product.category || "",
    });
    setIsEditDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      handle: "",
      productType: "",
      vendor: "",
      status: "ACTIVE",
      tags: [],
      imageUrl: "",
      variantCount: 1,
      stockCount: "",
      category: "",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-100 text-green-800";
      case "DRAFT":
        return "bg-yellow-100 text-yellow-800";
      case "ARCHIVED":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (!selectedBrand) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h2 className="mt-2 text-lg font-semibold">No Brand Found</h2>
          <p className="mt-1 text-sm text-gray-500">Please create a brand first to manage products.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Products</h1>
          <p className="text-gray-600">Manage your product catalog</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Product</DialogTitle>
            </DialogHeader>
            <ProductForm 
              isEdit={false}
              formData={formData}
              setFormData={setFormData}
              setIsCreateDialogOpen={setIsCreateDialogOpen}
              setIsEditDialogOpen={setIsEditDialogOpen}
              resetForm={resetForm}
              selectedProduct={null}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Product Catalog</CardTitle>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList>
              <TabsTrigger value="all">All ({filteredProducts.length})</TabsTrigger>
              <TabsTrigger value="active">Active ({filteredProducts.filter(p => p.status === "ACTIVE").length})</TabsTrigger>
              <TabsTrigger value="draft">Draft ({filteredProducts.filter(p => p.status === "DRAFT").length})</TabsTrigger>
              <TabsTrigger value="archived">Archived ({filteredProducts.filter(p => p.status === "ARCHIVED").length})</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">No products found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {searchTerm ? "Try adjusting your search terms" : "Get started by creating a new product"}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead>Stock</TableHead>
                      <TableHead>Variants</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => (
                      <TableRow key={product._id}>
                        <TableCell>
                          <div className="flex items-center space-x-3">
                            {product.imageUrl && (
                              <img
                                src={product.imageUrl}
                                alt={product.title}
                                className="h-10 w-10 rounded object-cover"
                              />
                            )}
                            <div>
                              <div className="font-medium">{product.title}</div>
                              <div className="text-sm text-gray-500">{product.handle}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(product.status)}>
                            {product.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {product.priceRange ? (
                            <div className="flex items-center">
                              <DollarSign className="h-4 w-4 text-gray-400" />
                              <span className="ml-1">
                                {product.priceRange.minPrice} - {product.priceRange.maxPrice}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {product.stockCount !== undefined ? (
                            <span className={product.stockCount > 0 ? "text-green-600" : "text-red-600"}>
                              {product.stockCount}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>{product.variantCount}</TableCell>
                        <TableCell>
                          {product.category || <span className="text-gray-400">-</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(product)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Product</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{product.title}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteProduct(product._id)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
          </DialogHeader>
          <ProductForm 
            isEdit={true}
            formData={formData}
            setFormData={setFormData}
            setIsCreateDialogOpen={setIsCreateDialogOpen}
            setIsEditDialogOpen={setIsEditDialogOpen}
            resetForm={resetForm}
            selectedProduct={selectedProduct}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}