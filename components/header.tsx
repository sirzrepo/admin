'use client';

import {
  Bell,
  Search,
  Settings,
  Moon,
  Sun,
  LogOut,
  UserSearch,
} from 'lucide-react';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { UserButton } from '@clerk/nextjs';

export function Header() {
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);


  return (
    <header className="fixed top-0 left-20 right-0 h-16 bg-card border-b border-border flex items-center justify-between px-6 z-30 md:left-0">
      <div></div>

      {/* Right Actions */}
      <div className="flex justify-end items-center gap-3">
        <div className="relative">
          {/* Search Container */}
          <div 
            className={`flex items-center justify-end transition-all duration-700 ease-out origin-right ${
              searchOpen 
                ? 'w-80 scale-x-100 opacity-100' 
                : 'w-10 scale-x-0 opacity-0'
            }`}
            style={{
              transform: searchOpen ? 'scaleX(1)' : 'scaleX(0)',
              transformOrigin: 'right center'
            }}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSearchOpen(false)}
              className={`w-8 h-8 mr-2 flex-shrink-0 transition-all duration-300 ${
                searchOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
              }`}
            >
              <span className="text-lg opacity-70 hover:opacity-100 transition-opacity">×</span>
            </Button>
            <div className="relative flex-1 bg-input border border-border rounded-lg overflow-hidden">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full pl-10 pr-4 py-2 bg-transparent text-foreground focus:outline-none text-sm"
                autoFocus
                onBlur={(e) => {
                  setTimeout(() => setSearchOpen(false), 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
              />
            </div>
          </div>
          
          {/* Search Icon Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            className={`absolute top-0 right-0 transition-all duration-300 ease-out ${
              searchOpen 
                ? 'scale-0 opacity-0 rotate-90' 
                : 'scale-100 opacity-100 rotate-0'
            }`}
          >
            <Search className="w-5 h-5" />
          </Button>
        </div>


        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>

        {/* Settings */}
        <DropdownMenu>
          {/* <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Settings className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger> */}
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Profile Settings</DropdownMenuItem>
            <DropdownMenuItem>Preferences</DropdownMenuItem>
            <DropdownMenuItem>Help & Support</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Profile Avatar */}
         <UserButton />
      </div>
    </header>
  );
}
