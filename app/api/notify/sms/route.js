export const dynamic = 'force-dynamic';
export async function POST(request) {
  const { phone, message } = await request.json();

  if (!phone || !message) {
    return Response.json({ error: 'phone and message are required' }, { status: 400 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return Response.json(
      {
        error: 'SMS provider not configured',
        message: 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER environment variables to enable SMS delivery.',
      },
      { status: 501 }
    );
  }

  try {
    const twilio = await import('twilio');
    const client = twilio.default(accountSid, authToken);
    await client.messages.create({
      to: phone,
      from: fromNumber,
      body: message,
    });

    return Response.json({ message: 'SMS sent successfully.' });
  } catch (error) {
    console.error('Failed to send SMS notification', error);
    return Response.json({ error: 'Failed to send SMS notification' }, { status: 500 });
  }
}
