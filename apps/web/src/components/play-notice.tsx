import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export const PlayNotice = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <main className='flex min-h-screen flex-col items-center justify-center gap-4 p-6'>
    <h1 className='text-xl font-bold'>{title}</h1>
    {children}
  </main>
);

export const PlayError = ({ error }: { readonly error: unknown }) => (
  <PlayNotice title='Could not build this arena'>
    <p className='text-slate-600'>
      {error instanceof Error ? error.message : 'Unknown error'}
    </p>
    <Link className='underline' to='/'>
      Pick another location
    </Link>
  </PlayNotice>
);
