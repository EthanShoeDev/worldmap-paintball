import type { ReactNode } from 'react';

const Credit = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) => (
  <a className='underline' href={href} target='_blank' rel='noreferrer'>
    {children}
  </a>
);

export const OsmAttribution = ({
  className = '',
}: {
  readonly className?: string;
}) => (
  <p className={`text-xs ${className}`}>
    Map data{' '}
    <Credit href='https://www.openstreetmap.org/copyright'>
      © OpenStreetMap contributors
    </Credit>
  </p>
);

// The arena is baked from OpenFreeMap's vector tiles plus Microsoft's
// footprints where OSM has no building, and its ground from aerial photos and
// elevation tiles when they were available.
export const ArenaAttribution = ({
  imagery,
  terrain,
  className = '',
}: {
  readonly imagery: boolean;
  readonly terrain: boolean;
  readonly className?: string;
}) => (
  <p className={`text-xs ${className}`}>
    <Credit href='https://openfreemap.org/'>OpenFreeMap</Credit>{' '}
    <Credit href='https://openmaptiles.org/'>© OpenMapTiles</Credit> Data from{' '}
    <Credit href='https://www.openstreetmap.org/copyright'>
      OpenStreetMap
    </Credit>
    {' · '}Buildings:{' '}
    <Credit href='https://github.com/microsoft/GlobalMLBuildingFootprints'>
      © Microsoft
    </Credit>{' '}
    (ODbL)
    {imagery && (
      <>
        {' · '}Imagery:{' '}
        <Credit href='https://www.usgs.gov/programs/national-geospatial-program/national-map'>
          USGS The National Map
        </Credit>
      </>
    )}
    {terrain && (
      <>
        {' · '}Terrain:{' '}
        <Credit href='https://registry.opendata.aws/terrain-tiles/'>
          Mapzen/Tilezen terrain tiles
        </Credit>{' '}
        from USGS 3DEP, SRTM and others
      </>
    )}
  </p>
);
