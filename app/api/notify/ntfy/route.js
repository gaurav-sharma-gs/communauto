import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { server, topic, message, title = 'CommunAuto Alert', priority, token } = await request.json();

  if (!server || !topic || !message) {
    return NextResponse.json({ error: 'server, topic, and message are required' }, { status: 400 });
  }

  const endpoint = `${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;

  try {
    const headers = new Headers();
    headers.set('Content-Type', 'text/plain');
    headers.set('Title', title);
    if (priority) headers.set('Priority', priority);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: message,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('ntfy request failed', response.status, text);
      return NextResponse.json({ error: 'Failed to send ntfy notification' }, { status: response.status });
    }

    return NextResponse.json({ message: 'ntfy notification request accepted.' });
  } catch (error) {
    console.error('Failed to send ntfy notification', error);
    return NextResponse.json({ error: 'Failed to send ntfy notification' }, { status: 500 });
  }
}
