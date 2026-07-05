import {
    PUBLIC_TURN_URL,
    PUBLIC_TURN_USERNAME,
    PUBLIC_TURN_CREDENTIAL
} from '$env/static/public';

/**
 * Nodyx Network Diagnostic Engine
 * Analyse la connectivité WebRTC (UDP, STUN, TURN)
 *
 * Les serveurs ICE viennent de l'API (`/instance/ice-servers`) : mêmes
 * credentials TURN éphémères que le vocal (HMAC, TTL 24h). Les variables
 * PUBLIC_TURN_* figées au build ne servent que de repli : des credentials
 * statiques expirent en <24h et faisaient afficher RELAY OFFLINE à tort.
 * Zéro STUN tiers : nexus-turn répond au STUN (et un serveur turn: fournit
 * aussi les candidats srflx), pas besoin de Google.
 */

async function fetchFreshIceServers(token: string | null): Promise<RTCIceServer[]> {
    if (!token) return [];
    try {
        const res = await fetch('/api/v1/instance/ice-servers', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.iceServers) ? data.iceServers : [];
    } catch {
        return [];
    }
}

function staticFallbackIceServers(): RTCIceServer[] {
    if (!PUBLIC_TURN_URL) return [];
    return [{
        urls: PUBLIC_TURN_URL,
        username: PUBLIC_TURN_USERNAME,
        credential: PUBLIC_TURN_CREDENTIAL
    }];
}

export async function runNetworkDiagnostic(
    onUpdate: (results: any) => void,
    token: string | null = null
) {

    let results = {
        udp: false,
        p2p: false,
        relay: false,
        candidates: [] as string[],
        status: 'testing',
        error: null as string | null
    };

    // Credentials frais d'abord ; repli statique si l'API est injoignable.
    let iceServers = await fetchFreshIceServers(token);
    if (iceServers.length === 0) {
        iceServers = staticFallbackIceServers();
    }
    if (iceServers.length === 0) {
        results.status = 'error';
        results.error = "Aucun serveur ICE configuré (TURN_PUBLIC_IP absent côté core ?)";
        onUpdate({ ...results });
        return;
    }

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const c = event.candidate.candidate;
            results.candidates.push(c);
            results.udp = true;

            if (c.includes('typ srflx')) results.p2p = true;
            if (c.includes('typ relay')) results.relay = true;

            onUpdate({ ...results });
        } else {
            results.status = 'finished';
            onUpdate({ ...results });
            pc.close();
        }
    };

    pc.onicecandidateerror = (event: any) => {
        // Correction : on utilise event.url pour détecter si c'est le TURN
        if (event.url && event.url.includes('turn')) {
            results.error = "Le serveur TURN ne répond pas.";
            onUpdate({ ...results });
        }
    };

    try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
    } catch (e: any) {
        results.status = 'error';
        results.error = e.message;
        onUpdate({ ...results });
    }

    setTimeout(() => {
        if (results.candidates.length === 0 && results.status === 'testing') {
            results.status = 'blocked';
            results.error = "UDP bloqué (Pare-feu agressif)";
            onUpdate({ ...results });
            pc.close();
        }
    }, 7000);
}
