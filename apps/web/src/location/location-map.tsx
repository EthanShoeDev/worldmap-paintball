import '@tanstack/react-start/client-only';
import { useAtom } from '@effect/atom-react';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { Layer, Map, type MapRef, Source } from 'react-map-gl/maplibre';

import { arenaSquare, type Coordinates, isCoordinates } from './coordinates.ts';
import { arenaHalfSize, selectionAtom } from './location-atoms.ts';

const style = 'https://tiles.openfreemap.org/styles/liberty';

const ArenaSquare = ({ center }: { readonly center: Coordinates }) => (
  <Source type='geojson' data={arenaSquare(center, arenaHalfSize)}>
    <Layer
      type='fill'
      paint={{ 'fill-color': '#ff3b6b', 'fill-opacity': 0.2 }}
    />
    <Layer type='line' paint={{ 'line-color': '#ff3b6b', 'line-width': 2 }} />
  </Source>
);

export const LocationPreview = ({
  location,
}: {
  readonly location: Coordinates;
}) => (
  <Map
    longitude={location.lon}
    latitude={location.lat}
    zoom={15}
    interactive={false}
    mapStyle={style}
    attributionControl={{ compact: true }}
  >
    <ArenaSquare center={location} />
  </Map>
);

export const LocationMap = () => {
  const [selection, setSelection] = useAtom(selectionAtom);
  const map = useRef<MapRef>(null);

  useEffect(() => {
    if (selection?.flyTo === true) {
      map.current?.flyTo({ center: [selection.lon, selection.lat], zoom: 16 });
    }
  }, [selection]);

  return (
    <Map
      ref={map}
      initialViewState={
        selection
          ? { longitude: selection.lon, latitude: selection.lat, zoom: 16 }
          : { longitude: 0, latitude: 30, zoom: 1.5 }
      }
      mapStyle={style}
      attributionControl={{ compact: false }}
      cursor='crosshair'
      onClick={(event) => {
        const { lat, lng } = event.lngLat.wrap();
        const coordinates = { lat, lon: lng };
        if (isCoordinates(coordinates)) {
          setSelection({
            ...coordinates,
            label: 'Picked on map',
            flyTo: false,
          });
        }
      }}
    >
      {selection && <ArenaSquare center={selection} />}
    </Map>
  );
};
