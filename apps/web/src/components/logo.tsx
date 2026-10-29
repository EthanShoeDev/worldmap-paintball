import { Link } from '@tanstack/react-router';

// A splat behind the wordmark; the blobs are fixed, so it renders the same
// on the server and in the browser.
const Splat = ({ className }: { readonly className: string }) => (
  <svg viewBox='0 0 120 100' className={className} aria-hidden='true'>
    <path
      fill='currentColor'
      d='M58 8c9 0 12 12 20 13s17-9 23-2-4 16 0 23 15 8 13 17-15 6-19 13 3 18-6 21-13-8-21-8-15 12-23 7 0-16-6-21-19-3-19-12 13-10 13-18-11-15-4-21 15 3 21-2 3-10 8-10z'
    />
    <circle fill='currentColor' cx='109' cy='12' r='5' />
    <circle fill='currentColor' cx='10' cy='88' r='4' />
    <circle fill='currentColor' cx='100' cy='92' r='3' />
  </svg>
);

export const Logo = ({
  size = 'large',
}: {
  readonly size?: 'large' | 'small';
}) => (
  <Link
    to='/'
    className='relative inline-flex w-fit flex-col leading-none select-none'
  >
    <Splat
      className={`absolute text-rose-500/80 ${size === 'large' ? '-top-4 -left-5 size-24' : '-top-2 -left-3 size-12'}`}
    />
    <span
      className={`relative font-display tracking-wide text-ink drop-shadow ${size === 'large' ? 'text-3xl' : 'text-lg'}`}
    >
      Worldmap
    </span>
    <span
      className={`relative bg-linear-to-r from-lime-300 via-yellow-300 to-orange-400 bg-clip-text font-display text-transparent ${size === 'large' ? 'text-4xl' : 'text-xl'}`}
    >
      Paintball
    </span>
  </Link>
);
