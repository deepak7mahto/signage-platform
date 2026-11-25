import type {
  FitMode,
  LayoutTemplateType,
  Orientation,
  RotationDeg,
  ScreenLayoutConfig,
  VenueType,
} from '@signage/shared';

export type AspectClass = 'landscape' | 'portrait' | 'ultrawide';

export interface WallScenario {
  slot: string;
  name: string;
  location: string;
  city: string;
  venueType: VenueType;
  orientation: Orientation;
  aspectClass: AspectClass;
  aspectLabel: string;
  layout: ScreenLayoutConfig;
  defaultPlaylistName: string;
  groups: string[];
}

export interface TileStatusMessage {
  type: 'signage:status';
  slot: string;
  state: 'pairing' | 'paired';
  code?: string | null;
  screenId?: string;
  screenName?: string | null;
  playlistName?: string | null;
  scheduleName?: string | null;
  layoutTemplate?: LayoutTemplateType;
  orientation?: Orientation;
  fitMode?: FitMode;
  rotationDeg?: RotationDeg;
  viewport?: string;
  wsConnected?: boolean;
}

export const EMERGENCY_SCHEDULE_NAME = 'Network-Wide Emergency Alert';

export const WALL_SCENARIOS: WallScenario[] = [
  {
    slot: 'clinic-waiting',
    name: 'Clinic Waiting Room TV',
    location: 'OPD Waiting Hall • Floor 1',
    city: 'New Delhi',
    venueType: 'clinic',
    orientation: 'landscape',
    aspectClass: 'landscape',
    aspectLabel: '16:9',
    layout: {
      template: 'split_sidebar',
      fitMode: 'contain',
      rotationDeg: 0,
      transition: 'fade',
      syncMode: 'independent',
      sidebarTitle: 'OPD Token Queue',
      sidebarLines: [
        'Room 101 • Token A-14 (Dr. Sharma)',
        'Room 102 • Token B-08 (Dr. Verma)',
        'Pharmacy • Ready: A-11, A-12',
        'Free Wi-Fi: ClinicGuest',
      ],
    },
    defaultPlaylistName: 'Lifestyle & Refreshment Loop',
    groups: ['North India Network', 'Clinic & Healthcare'],
  },
  {
    slot: 'retail-entrance',
    name: 'Retail Storefront Entrance',
    location: 'Phoenix Mall Atrium',
    city: 'Mumbai',
    venueType: 'retail',
    orientation: 'landscape',
    aspectClass: 'landscape',
    aspectLabel: '16:9',
    layout: {
      template: 'bottom_ticker',
      fitMode: 'cover',
      rotationDeg: 0,
      transition: 'fade',
      syncMode: 'clock_sync',
      tickerText:
        'FLASH SALE • Up to 40% Off Today • Visit Level 2 Flagship Store • Powered by SignageOS',
      sidebarLines: [],
    },
    defaultPlaylistName: 'Commercial Ad Loop (5 Videos)',
    groups: ['Retail & Mall'],
  },
  {
    slot: 'corp-lobby',
    name: 'Corporate Lobby 4K Wall',
    location: 'Main Reception Tower A',
    city: 'Bengaluru',
    venueType: 'corporate',
    orientation: 'landscape',
    aspectClass: 'landscape',
    aspectLabel: '16:9',
    layout: {
      template: 'fullscreen',
      fitMode: 'cover',
      rotationDeg: 0,
      transition: 'slide_left',
      syncMode: 'independent',
      sidebarLines: [],
    },
    defaultPlaylistName: 'Luxury Auto & Tech Spotlight',
    groups: ['Corporate & Transit'],
  },
  {
    slot: 'transit-gate',
    name: 'Airport Transit Gate B4',
    location: 'Terminal 3 • Departure Gate B4',
    city: 'New Delhi',
    venueType: 'transit',
    orientation: 'landscape',
    aspectClass: 'landscape',
    aspectLabel: '16:9',
    layout: {
      template: 'bottom_ticker',
      fitMode: 'contain',
      rotationDeg: 0,
      transition: 'fade',
      syncMode: 'independent',
      tickerText:
        'GATE B4 • Boarding AI-402 to Mumbai (14:25) • Please keep boarding pass ready',
      sidebarLines: [],
    },
    defaultPlaylistName: 'Commercial Ad Loop (5 Videos)',
    groups: ['North India Network', 'Corporate & Transit'],
  },
  {
    slot: 'mall-totem',
    name: 'Mall Portrait Kiosk (9:16)',
    location: 'Phoenix Mall Level 2 Totem',
    city: 'Mumbai',
    venueType: 'retail',
    orientation: 'portrait',
    aspectClass: 'portrait',
    aspectLabel: '9:16 portrait',
    layout: {
      template: 'split_sidebar',
      fitMode: 'blur_fill',
      rotationDeg: 0,
      transition: 'fade',
      syncMode: 'clock_sync',
      sidebarTitle: 'Directory & Offers',
      sidebarLines: [
        'Level 1 • Nike Flagship',
        'Level 2 • Apple Store',
        'Food Court • 20% Off',
        'Wi-Fi: MallFree5G',
      ],
    },
    defaultPlaylistName: 'Commercial Ad Loop (5 Videos)',
    groups: ['Retail & Mall'],
  },
  {
    slot: 'highway-banner',
    name: 'Highway LED Ribbon (21:9)',
    location: 'NH-48 CyberHub Facade',
    city: 'Gurugram',
    venueType: 'highway',
    orientation: 'landscape',
    aspectClass: 'ultrawide',
    aspectLabel: '21:9 ultrawide',
    layout: {
      template: 'fullscreen',
      fitMode: 'blur_fill',
      rotationDeg: 0,
      transition: 'zoom',
      syncMode: 'independent',
      sidebarLines: [],
    },
    defaultPlaylistName: 'Luxury Auto & Tech Spotlight',
    groups: ['North India Network'],
  },
];
