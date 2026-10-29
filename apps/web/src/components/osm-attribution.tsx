export const OsmAttribution = ({
  className = '',
}: {
  readonly className?: string;
}) => (
  <p className={`text-xs ${className}`}>
    Map data{' '}
    <a
      className='underline'
      href='https://www.openstreetmap.org/copyright'
      target='_blank'
      rel='noreferrer'
    >
      © OpenStreetMap contributors
    </a>
  </p>
);
