import { Link } from '@tanstack/react-router';
import { outsideCoverageMessage } from '@worldmap-paintball/api-contract/coverage';
import type { ReactNode } from 'react';

import { apiErrorMessage } from '../api-client.ts';

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

const PickAnother = () => (
  <Link className='underline' to='/'>
    Pick another location
  </Link>
);

export const OutsideCoverageNotice = () => (
  <PlayNotice title={outsideCoverageMessage}>
    <p className='text-slate-600'>Arenas can only be built there for now.</p>
    <PickAnother />
  </PlayNotice>
);

export const PlayError = ({ error }: { readonly error: unknown }) => (
  <PlayNotice title='Could not build this arena'>
    <p className='text-slate-600'>{apiErrorMessage(error)}</p>
    <PickAnother />
  </PlayNotice>
);
