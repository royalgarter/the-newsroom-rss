// ... existing imports ...
import {serve} from "https://deno.land/std@0.170.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt/mod.ts";

// ... existing constants ...

async function generateToken() {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string) {
  return await bcrypt.hash(password);
}

async function verifyPassword(password: string, hash: string) {
  return await bcrypt.compare(password, hash);
}

async function authenticateRequest(req: Request) {
  const token = req.headers.get('Authorization')?.split(' ')[1];
  if (!token) return null;
  
  const session = await KV.get(['sessions', token]);
  return session.value;
}

// ... existing code ...

async function handleRequest(req: Request) {
  const {pathname, searchParams} = new URL(req.url);

  // Add authentication endpoints
  if (pathname === "/api/auth/register") {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    
    const { username, password } = await req.json();
    const existingUser = await KV.get(['users', username]);
    
    if (existingUser.value) {
      return new Response(JSON.stringify({ error: 'User already exists' }), { 
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const hashedPassword = await hashPassword(password);
    await KV.set(['users', username], { username, password: hashedPassword });

    return new Response(JSON.stringify({ message: 'User registered successfully' }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  if (pathname === "/api/auth/login") {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    
    const { username, password } = await req.json();
    const user = await KV.get(['users', username]);
    
    if (!user.value || !(await verifyPassword(password, user.value.password))) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    const token = await generateToken();
    await KV.set(['sessions', token], { username }, { expireIn: 24 * 60 * 60 * 1000 }); // 24 hours

    return new Response(JSON.stringify({ token }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // Protect routes that need authentication
  if (pathname.startsWith('/api/feeds')) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }
  }

  // ... rest of your existing handleRequest code ...
}