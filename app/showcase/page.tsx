"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, ArrowUp, ArrowDown, Clapperboard, Loader2, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ShowcaseForm, { type ShowcaseFormData } from "./components/showcase-form";

interface ShowcaseItem {
  _id: Id<"showcaseItems">;
  title: string;
  tag: string;
  caption: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  categoryId?: Id<"showcaseCategories"> | null;
  sortOrder: number;
  isPublished: boolean;
}

interface ShowcaseCategory {
  _id: Id<"showcaseCategories">;
  name: string;
}

const emptyForm: ShowcaseFormData = {
  title: "",
  tag: "",
  caption: "",
  imageUrl: "",
  videoUrl: "",
  categoryId: "",
};

export default function ShowcasePage() {
  const { toast } = useToast();
  const items = useQuery(api.showcase.listAll);
  const categories = useQuery(api.showcaseCategories.list) as
    | ShowcaseCategory[]
    | undefined;

  const createItem = useMutation(api.showcase.createItem);
  const updateItem = useMutation(api.showcase.updateItem);
  const deleteItem = useMutation(api.showcase.deleteItem);
  const reorderItems = useMutation(api.showcase.reorderItems);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ShowcaseItem | null>(null);
  const [formData, setFormData] = useState<ShowcaseFormData>(emptyForm);

  const categoryName = (categoryId: Id<"showcaseCategories"> | null | undefined) =>
    categoryId
      ? (categories?.find((category) => category._id === categoryId)?.name ?? null)
      : null;

  const openEdit = (item: ShowcaseItem) => {
    setSelectedItem(item);
    setFormData({
      title: item.title,
      tag: item.tag,
      caption: item.caption,
      imageUrl: item.imageUrl ?? "",
      videoUrl: item.videoUrl ?? "",
      categoryId: item.categoryId ?? "",
    });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    try {
      await createItem({
        title: formData.title,
        tag: formData.tag,
        caption: formData.caption,
        imageUrl: formData.imageUrl || null,
        videoUrl: formData.videoUrl || null,
        categoryId: (formData.categoryId || undefined) as
          | Id<"showcaseCategories">
          | undefined,
      });
      toast({ title: "Item created", description: "Showcase item has been added." });
      setIsCreateOpen(false);
      setFormData(emptyForm);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create item.",
        variant: "destructive",
      });
    }
  };

  const handleUpdate = async () => {
    if (!selectedItem) return;
    try {
      await updateItem({
        itemId: selectedItem._id,
        title: formData.title,
        tag: formData.tag,
        caption: formData.caption,
        imageUrl: formData.imageUrl || null,
        videoUrl: formData.videoUrl || null,
        categoryId: (formData.categoryId || null) as
          | Id<"showcaseCategories">
          | null,
      });
      toast({ title: "Item updated", description: "Showcase item has been saved." });
      setIsEditOpen(false);
      setSelectedItem(null);
      setFormData(emptyForm);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update item.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (itemId: Id<"showcaseItems">) => {
    try {
      await deleteItem({ itemId });
      toast({ title: "Item deleted", description: "Showcase item has been removed." });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete item.",
        variant: "destructive",
      });
    }
  };

  const handleTogglePublish = async (item: ShowcaseItem) => {
    try {
      await updateItem({ itemId: item._id, isPublished: !item.isPublished });
      toast({ title: item.isPublished ? "Item hidden" : "Item published" });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update item.",
        variant: "destructive",
      });
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!items) return;
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderItems({ orderedIds: reordered.map((item) => item._id) });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reorder items.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Showcase</h1>
          <p className="text-gray-600">
            Manage the “Made with SIRz” creative wall on the marketing site
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Add Showcase Item</DialogTitle>
            </DialogHeader>
            <ShowcaseForm
              formData={formData}
              setFormData={setFormData}
              onCancel={() => setIsCreateOpen(false)}
              onSubmit={handleCreate}
              submitLabel="Create Item"
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Creative Wall ({items?.filter((item) => item.isPublished).length ?? 0} published · {items?.length ?? 0} total)</CardTitle>
        </CardHeader>
        <CardContent>
          {!items ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <Clapperboard className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-semibold text-gray-900">No showcase items yet</h3>
              <p className="mt-1 text-sm text-gray-500">Add your first creative to the wall.</p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item, index) => (
                <div
                  key={item._id}
                  className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
                  <div className="relative aspect-[4/5] bg-black">
                    {item.videoUrl ? (
                      <video
                        src={item.videoUrl}
                        poster={item.imageUrl || undefined}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onMouseEnter={(e) => void e.currentTarget.play()}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <img
                        src={item.imageUrl ?? undefined}
                        alt={`${item.tag} for ${item.title}`}
                        className="h-full w-full object-cover"
                      />
                    )}
                    {item.videoUrl && (
                      <span className="pointer-events-none absolute inset-0 grid place-items-center">
                        <span className="grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white backdrop-blur">
                          <Play className="h-4 w-4 translate-x-[1px] fill-white" />
                        </span>
                      </span>
                    )}
                    {!item.isPublished && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Badge className="bg-gray-800">Hidden</Badge>
                      </div>
                    )}
                    <Badge className="absolute left-2 top-2 bg-white/90 text-gray-900 backdrop-blur">
                      {item.videoUrl ? "Video" : "Image"}
                    </Badge>
                    <Badge className="absolute right-2 top-2 bg-white/90 text-gray-900 backdrop-blur">
                      {item.tag}
                    </Badge>
                  </div>
                  <div className="space-y-2 p-3">
                    <div>
                      <div className="font-semibold text-gray-900">{item.title}</div>
                      <div className="text-xs text-gray-500">{item.caption}</div>
                      {categoryName(item.categoryId) && (
                        <div className="mt-1 text-[11px] font-medium text-indigo-600">
                          {categoryName(item.categoryId)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={index === 0}
                          onClick={() => handleMove(index, -1)}
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={index === items.length - 1}
                          onClick={() => handleMove(index, 1)}
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">Live</span>
                        <Switch
                          checked={item.isPublished}
                          onCheckedChange={() => handleTogglePublish(item)}
                        />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(item)} title="Edit">
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600" title="Delete">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Showcase Item</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete “{item.title}”? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => handleDelete(item._id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Showcase Item</DialogTitle>
          </DialogHeader>
          <ShowcaseForm
            formData={formData}
            setFormData={setFormData}
            onCancel={() => {
              setIsEditOpen(false);
              setSelectedItem(null);
              setFormData(emptyForm);
            }}
            onSubmit={handleUpdate}
            submitLabel="Save Changes"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
