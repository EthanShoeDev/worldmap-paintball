import { createFileRoute } from '@tanstack/react-router';

import { Welcome } from '../components/welcome.tsx';

const Home = () => <Welcome name='world' />;

export const Route = createFileRoute('/')({ component: Home });
