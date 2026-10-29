export const Welcome = ({ name }: { readonly name: string }) => (
  <main className='flex min-h-screen items-center justify-center'>
    <h1 className='text-4xl font-bold'>Hello, {name}!</h1>
  </main>
);
