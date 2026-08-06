<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import * as THREE from 'three';

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene;
	let camera: THREE.PerspectiveCamera;
	let renderer: THREE.WebGLRenderer;
	let orbs: THREE.Group[] = [];
	let ripples: THREE.Sprite[] = [];
	let animationId = 0;
	let time = 0;

	let mouseNDC = new THREE.Vector2();
	let mouseX = 0, mouseY = 0;
	let raycaster = new THREE.Raycaster();

	const ORB_DATA = [
		{ color: '#7c3aed', size: 5 },
		{ color: '#a855f7', size: 4 },
		{ color: '#8b5cf6', size: 6 },
		{ color: '#a78bfa', size: 3.5 },
		{ color: '#c4b5fd', size: 4.5 },
		{ color: '#6d28d9', size: 5.5 },
		{ color: '#a855f7', size: 4 },
		{ color: '#8b5cf6', size: 5 },
	];

	function makePersonTexture(): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size; canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = 'rgba(255,255,255,0.9)';
		ctx.beginPath();
		ctx.arc(size/2, size/2 - 30, 28, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(size/2 - 45, size/2 + 55);
		ctx.quadraticCurveTo(size/2 - 45, size/2 + 15, size/2 - 20, size/2 + 8);
		ctx.lineTo(size/2 + 20, size/2 + 8);
		ctx.quadraticCurveTo(size/2 + 45, size/2 + 15, size/2 + 45, size/2 + 55);
		ctx.closePath();
		ctx.fill();
		const texture = new THREE.Texture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	function makeOrbTexture(color: string): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size; canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const cx = size / 2, cy = size / 2, r = size / 2 - 2;

		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
		grad.addColorStop(0, color + '40');
		grad.addColorStop(0.5, color + '15');
		grad.addColorStop(0.85, color + '08');
		grad.addColorStop(1, color + '20');
		ctx.fillStyle = grad;
		ctx.fill();

		ctx.beginPath();
		ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
		ctx.strokeStyle = color + '30';
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.beginPath();
		ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.3, 0, Math.PI * 2);
		const highlight = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, 0, cx - r * 0.35, cy - r * 0.35, r * 0.3);
		highlight.addColorStop(0, 'rgba(255,255,255,0.15)');
		highlight.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = highlight;
		ctx.fill();

		ctx.beginPath();
		ctx.arc(cx, cy, r - 1, Math.PI * 0.2, Math.PI * 0.8);
		ctx.strokeStyle = color + '50';
		ctx.lineWidth = 3;
		ctx.stroke();

		const texture = new THREE.Texture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	function makeGlowTexture(color: string): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size; canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
		grad.addColorStop(0, color + '25');
		grad.addColorStop(0.3, color + '10');
		grad.addColorStop(1, color + '00');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, size, size);
		const texture = new THREE.Texture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	function makeRippleTexture(color: string): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size; canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		ctx.beginPath();
		ctx.arc(size/2, size/2, size/2 - 8, 0, Math.PI * 2);
		ctx.strokeStyle = color;
		ctx.lineWidth = 6;
		ctx.stroke();
		const texture = new THREE.Texture(canvas);
		texture.needsUpdate = true;
		return texture;
	}

	function init() {
		if (!canvas) return;
		const container = canvas.parentElement!;
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w === 0 || h === 0) return;

		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
		camera.position.z = 50;

		renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
		renderer.setSize(w, h);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		const personTex = makePersonTexture();

		ORB_DATA.forEach((data, i) => {
			const orbGroup = new THREE.Group();

			const orbTex = makeOrbTexture(data.color);
			const orbMat = new THREE.SpriteMaterial({ map: orbTex, transparent: true, opacity: 0.7, depthWrite: false });
			const orb = new THREE.Sprite(orbMat);
			orb.scale.set(data.size, data.size, 1);
			orbGroup.add(orb);

			const personMat = new THREE.SpriteMaterial({ map: personTex, transparent: true, opacity: 0.6, depthWrite: false });
			const person = new THREE.Sprite(personMat);
			person.scale.set(data.size * 0.5, data.size * 0.5, 1);
			orbGroup.add(person);

			const glowTex = makeGlowTexture(data.color);
			const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthWrite: false });
			const glow = new THREE.Sprite(glowMat);
			glow.scale.set(data.size * 2, data.size * 2, 1);
			orbGroup.add(glow);

			const angle = (i / ORB_DATA.length) * Math.PI * 2 + Math.random() * 0.5;
			const dist = 12 + Math.random() * 18;
			const z = (Math.random() - 0.5) * 10;
			orbGroup.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist * 0.7, z);

			orbGroup.userData = {
				basePos: orbGroup.position.clone(),
				floatSpeed: 0.08 + Math.random() * 0.2,
				floatAmp: 1.5 + Math.random() * 3,
				phase: Math.random() * Math.PI * 2,
				color: data.color,
				orb, person, glow,
				baseGlowOp: 0.5, baseOrbOp: 0.7, basePersonOp: 0.6,
				pulseTimer: Math.random() * 6,
				pulseActive: false,
				pulseStart: 0,
				baseSize: data.size,
				hoverProx: 0,
				pushVel: new THREE.Vector3(),
			};

			scene.add(orbGroup);
			orbs.push(orbGroup);
		});

		// Mouse tracking
		container.addEventListener('mousemove', onMouseMove);
		container.addEventListener('click', onClick);
		window.addEventListener('resize', onResize);
	}

	function onMouseMove(e: MouseEvent) {
		const container = canvas.parentElement!;
		const rect = container.getBoundingClientRect();
		mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
		mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
		mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
	}

	function onClick(e: MouseEvent) {
		const container = canvas.parentElement!;
		const rect = container.getBoundingClientRect();
		const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

		let clickedIdx = -1;
		let minDist = Infinity;
		orbs.forEach((group, idx) => {
			const screenPos = group.position.clone().project(camera);
			const dx = screenPos.x - ndcX;
			const dy = screenPos.y - ndcY;
			const d = Math.sqrt(dx * dx + dy * dy);
			if (d < 0.08 && d < minDist) { minDist = d; clickedIdx = idx; }
		});

		if (clickedIdx >= 0) {
			const clicked = orbs[clickedIdx];
			const ud = clicked.userData as any;
			const color = ud.color as string;

			const rippleTex = makeRippleTexture(color);
			const rippleMat = new THREE.SpriteMaterial({ map: rippleTex, transparent: true, opacity: 0.8, depthWrite: false });
			const ripple = new THREE.Sprite(rippleMat);
			ripple.position.copy(clicked.position);
			ripple.scale.set(ud.baseSize, ud.baseSize, 1);
			ripple.userData = { life: 0, maxLife: 1.2, baseSize: ud.baseSize };
			scene.add(ripple);
			ripples.push(ripple);

			orbs.forEach((other, idx) => {
				if (idx === clickedIdx) return;
				const diff = other.position.clone().sub(clicked.position);
				const d = diff.length();
				if (d < 15) {
					const force = (1 - d / 15) * 3;
					diff.normalize().multiplyScalar(force);
					(other.userData as any).pushVel.add(diff);
				}
			});

			ud.pulseActive = true;
			ud.pulseStart = time;
			ud.pulseTimer = 0;
		}
	}

	function onResize() {
		if (!canvas) return;
		const container = canvas.parentElement!;
		const w = container.clientWidth;
		const h = container.clientHeight;
		if (w === 0 || h === 0) return;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}

	function animate() {
		animationId = requestAnimationFrame(animate);
		time += 0.005;

		orbs.forEach((group) => {
			const ud = group.userData as any;

			group.position.x = ud.basePos.x + Math.sin(time * ud.floatSpeed + ud.phase) * ud.floatAmp;
			group.position.y = ud.basePos.y + Math.cos(time * ud.floatSpeed * 0.6 + ud.phase) * ud.floatAmp;
			group.position.z = ud.basePos.z + Math.sin(time * ud.floatSpeed * 0.4 + ud.phase) * 1.5;

			// Push velocity (from click)
			group.position.add(ud.pushVel);
			ud.pushVel.multiplyScalar(0.92);
			const pullBack = ud.basePos.clone().sub(group.position).multiplyScalar(0.02);
			ud.pushVel.add(pullBack);

			// Hover proximity
			const screenPos = group.position.clone().project(camera);
			const dx = screenPos.x - mouseNDC.x;
			const dy = screenPos.y - mouseNDC.y;
			const screenDist = Math.sqrt(dx * dx + dy * dy);
			const targetProx = Math.max(0, 1 - screenDist / 0.1);
			ud.hoverProx += (targetProx - ud.hoverProx) * 0.1;

			const hoverScale = 1 + ud.hoverProx * 0.3;
			const s = ud.baseSize * hoverScale;
			ud.orb.scale.set(s, s, 1);
			ud.glow.scale.set(s * 2, s * 2, 1);
			ud.person.scale.set(s * 0.5, s * 0.5, 1);
			ud.orb.material.opacity = ud.baseOrbOp + ud.hoverProx * 0.2;
			ud.glow.material.opacity = ud.baseGlowOp + ud.hoverProx * 0.4;
			ud.person.material.opacity = ud.basePersonOp + ud.hoverProx * 0.3;

			// Auto pulse
			ud.pulseTimer += 0.016;
			if (!ud.pulseActive && ud.pulseTimer > 4 + Math.random() * 6) {
				ud.pulseActive = true;
				ud.pulseStart = time;
				ud.pulseTimer = 0;
			}
			if (ud.pulseActive) {
				const elapsed = time - ud.pulseStart;
				if (elapsed < 1.5) {
					const intensity = Math.sin((elapsed / 1.5) * Math.PI);
					ud.glow.material.opacity += intensity * 0.3;
					ud.orb.material.opacity += intensity * 0.1;
				} else {
					ud.pulseActive = false;
				}
			}
		});

		// Ripples
		for (let i = ripples.length - 1; i >= 0; i--) {
			const r = ripples[i];
			(r.userData as any).life += 0.016;
			const t = (r.userData as any).life / (r.userData as any).maxLife;
			if (t >= 1) {
				scene.remove(r);
				ripples.splice(i, 1);
				continue;
			}
			const scale = (r.userData as any).baseSize * (1 + t * 4);
			r.scale.set(scale, scale, 1);
			r.material.opacity = 0.8 * (1 - t);
		}

		// Camera parallax
		const targetX = mouseX * 4 + Math.sin(time * 0.04) * 1.5;
		const targetY = -mouseY * 3 + Math.cos(time * 0.03) * 1;
		camera.position.x += (targetX - camera.position.x) * 0.03;
		camera.position.y += (targetY - camera.position.y) * 0.03;
		camera.lookAt(0, 0, 0);

		renderer.render(scene, camera);
	}

	onMount(() => {
		init();
		animate();
	});

	onDestroy(() => {
		if (!browser) return;
		cancelAnimationFrame(animationId);
		if (canvas && canvas.parentElement) {
			canvas.parentElement.removeEventListener('mousemove', onMouseMove);
			canvas.parentElement.removeEventListener('click', onClick);
		}
		window.removeEventListener('resize', onResize);
		if (renderer) renderer.dispose();
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 w-full h-full pointer-events-auto cursor-pointer"></canvas>
