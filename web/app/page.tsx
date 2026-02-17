import Link from 'next/link';

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome</h1>
      <p className="text-neutral-400">Start a Studio session to create a short video.</p>
      <Link href="/studio" className="inline-block px-3 py-2 rounded bg-blue-600 hover:bg-blue-500">
        Open Studio
      </Link>
    </div>
  );
}
