import fetch from 'node-fetch';

const NTFY_TOPIC = 'communauto-ntfy';
const NTFY_SERVER = 'https://ntfy.sh';

async function sendNtfyNotification(title, message) {
    console.log(`Sending notification to ${NTFY_SERVER}/${NTFY_TOPIC}...`);
    try {
        const response = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, {
            method: 'POST',
            body: message,
            headers: {
                'Title': title,
                'Priority': 'default',
            }
        });
        const text = await response.text();
        console.log('Response:', response.status, text);
    } catch (err) {
        console.error('Failed to send notification:', err);
    }
}

async function runTest() {
    console.log('Starting Notification Test...');
    await sendNtfyNotification('Test Alert', 'This is a test notification from the debug script.');
    console.log('Test Complete.');
}

runTest();
