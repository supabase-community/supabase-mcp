import { type UnionToTuple, type ValueOf } from './util.js';

export type AwsRegion = {
  code: string;
  displayName: string;
  location: Location;
};

export type Location = {
  lat: number;
  lng: number;
};

export const AWS_REGIONS = {
  WEST_US: {
    code: 'us-west-1',
    displayName: 'West US (North California)',
    location: { lat: 37.774929, lng: -122.419418 },
  },
  EAST_US: {
    code: 'us-east-1',
    displayName: 'East US (North Virginia)',
    location: { lat: 37.926868, lng: -78.024902 },
  },
  EAST_US_2: {
    code: 'us-east-2',
    displayName: 'East US (Ohio)',
    location: { lat: 39.9612, lng: -82.9988 },
  },
  CENTRAL_CANADA: {
    code: 'ca-central-1',
    displayName: 'Canada (Central)',
    location: { lat: 56.130367, lng: -106.346771 },
  },
  WEST_EU: {
    code: 'eu-west-1',
    displayName: 'West EU (Ireland)',
    location: { lat: 53.3498, lng: -6.2603 },
  },
  WEST_EU_2: {
    code: 'eu-west-2',
    displayName: 'West Europe (London)',
    location: { lat: 51.507351, lng: -0.127758 },
  },
  WEST_EU_3: {
    code: 'eu-west-3',
    displayName: 'West EU (Paris)',
    location: { lat: 2.352222, lng: 48.856613 },
  },
  CENTRAL_EU: {
    code: 'eu-central-1',
    displayName: 'Central EU (Frankfurt)',
    location: { lat: 50.110924, lng: 8.682127 },
  },
  CENTRAL_EU_2: {
    code: 'eu-central-2',
    displayName: 'Central Europe (Zurich)',
    location: { lat: 47.3744489, lng: 8.5410422 },
  },
  NORTH_EU: {
    code: 'eu-north-1',
    displayName: 'North EU (Stockholm)',
    location: { lat: 59.3251172, lng: 18.0710935 },
  },
  SOUTH_ASIA: {
    code: 'ap-south-1',
    displayName: 'South Asia (Mumbai)',
    location: { lat: 18.9733536, lng: 72.8281049 },
  },
  SOUTHEAST_ASIA: {
    code: 'ap-southeast-1',
    displayName: 'Southeast Asia (Singapore)',
    location: { lat: 1.357107, lng: 103.8194992 },
  },
  NORTHEAST_ASIA: {
    code: 'ap-northeast-1',
    displayName: 'Northeast Asia (Tokyo)',
    location: { lat: 35.6895, lng: 139.6917 },
  },
  NORTHEAST_ASIA_2: {
    code: 'ap-northeast-2',
    displayName: 'Northeast Asia (Seoul)',
    location: { lat: 37.5665, lng: 126.978 },
  },
  OCEANIA: {
    code: 'ap-southeast-2',
    displayName: 'Oceania (Sydney)',
    location: { lat: -33.8688, lng: 151.2093 },
  },
  SOUTH_AMERICA: {
    code: 'sa-east-1',
    displayName: 'South America (São Paulo)',
    location: { lat: -1.2043218, lng: -47.1583944 },
  },
} as const satisfies Record<string, AwsRegion>;

export type RegionCodes = ValueOf<typeof AWS_REGIONS>['code'];

export const AWS_REGION_CODES = Object.values(AWS_REGIONS).map(
  (region) => region.code
) as UnionToTuple<RegionCodes>;
