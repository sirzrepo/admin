"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calendar, Clock, Users, TrendingUp, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function BrandCampaignsPage() {
  const campaigns = useQuery(api.campaigns.getAllCampaigns);

  if (campaigns === undefined) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">All Campaigns</h1>
        </div>
        <div className="grid gap-6">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[250px]" />
                    <Skeleton className="h-3 w-[200px]" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!campaigns || campaigns.length === 0) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">All Campaigns</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <TrendingUp className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No campaigns found</h3>
            <p className="text-muted-foreground text-center">
              There are no campaigns in the system yet.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "draft":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "completed":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "paused":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getCampaignTypeColor = (type: string) => {
    switch (type) {
      case "brandTemplate":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "custom":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">All Campaigns</h1>
          <p className="text-muted-foreground">
            Admin view of all campaigns across all brands
          </p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{campaigns.length} total campaigns</span>
        </div>
      </div>

      <div className="grid gap-6">
        {campaigns.map((campaign) => (
          <Card key={campaign._id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  {campaign.brand && (
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={campaign.brand.logoUrl} alt={campaign.brand.name} />
                      <AvatarFallback>
                        {campaign.brand.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="space-y-1">
                    <CardTitle className="text-xl">{campaign.name}</CardTitle>
                    <CardDescription className="flex items-center space-x-2">
                      {campaign.brand && (
                        <span className="font-medium">{campaign.brand.name}</span>
                      )}
                      <span>•</span>
                      <span className="flex items-center space-x-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          Created {formatDistanceToNow(campaign.createdAt, { addSuffix: true })}
                        </span>
                      </span>
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-col items-end space-y-2">
                  <Badge className={getStatusColor(campaign.status)}>
                    {campaign.status}
                  </Badge>
                  <Badge variant="outline" className={getCampaignTypeColor(campaign.campaignType)}>
                    {campaign.campaignType}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {campaign.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {campaign.description}
                  </p>
                )}
                
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center space-x-4">
                    {campaign.selectedTypes && campaign.selectedTypes.length > 0 && (
                      <div className="flex items-center space-x-1">
                        <span className="text-muted-foreground">Types:</span>
                        <span className="font-medium">{campaign.selectedTypes.length}</span>
                      </div>
                    )}
                    {campaign.selectedAngles && campaign.selectedAngles.length > 0 && (
                      <div className="flex items-center space-x-1">
                        <span className="text-muted-foreground">Angles:</span>
                        <span className="font-medium">{campaign.selectedAngles.length}</span>
                      </div>
                    )}
                    {campaign.products && campaign.products.length > 0 && (
                      <div className="flex items-center space-x-1">
                        <span className="text-muted-foreground">Products:</span>
                        <span className="font-medium">{campaign.products.length}</span>
                      </div>
                    )}
                  </div>
                  {campaign.updatedAt && campaign.updatedAt !== campaign.createdAt && (
                    <div className="flex items-center space-x-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Updated {formatDistanceToNow(campaign.updatedAt, { addSuffix: true })}
                      </span>
                    </div>
                  )}
                </div>

                {campaign.selectedTypes && campaign.selectedTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {campaign.selectedTypes.slice(0, 3).map((type, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {type}
                      </Badge>
                    ))}
                    {campaign.selectedTypes.length > 3 && (
                      <Badge variant="secondary" className="text-xs">
                        +{campaign.selectedTypes.length - 3} more
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}