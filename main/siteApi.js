'use strict';
// Calls to the website: signed-in JSON requests, allowed hosts, and turning the sign-in cookie into an app session (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { app } = require('electron');
const https = require('https');

// POST a JSON body to the ARMGDDN site with the member's app-session token.
function getJsonWithBearer(urlString, bearerToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    if (u.protocol !== 'https:' || !isAllowedServiceHost(u.hostname)) { reject(new Error('Security error: not the ARMGDDN site')); return; }
    const req = https.request({
      hostname: u.hostname, port: u.port ? Number(u.port) : 443, path: u.pathname + (u.search || ''), method: 'GET',
      headers: { 'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(), ...(bearerToken ? { 'Authorization': 'Bearer ' + bearerToken } : {}) },
      timeout: 20000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (e) { /* ignore */ } resolve({ statusCode: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch (e) { } });
    req.end();
  });
}

function postJsonWithBearer(urlString, bodyObj, bearerToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    if (u.protocol !== 'https:' || !isAllowedServiceHost(u.hostname)) { reject(new Error('Security error: not the ARMGDDN site')); return; }
    const body = JSON.stringify(bodyObj || {});
    const req = https.request({
      hostname: u.hostname, port: u.port ? Number(u.port) : 443, path: u.pathname + (u.search || ''), method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(), ...(bearerToken ? { 'Authorization': 'Bearer ' + bearerToken } : {}) },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch (e) { /* ignore */ } resolve({ statusCode: res.statusCode, json, text: data }); });
    });
    req.on('error', reject);
    req.on('timeout', () => { try { req.destroy(new Error('Request timeout')); } catch (e) { } });
    req.write(body);
    req.end();
  });
}

function isAllowedServiceHost(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (ctx.ALLOWED_SERVICE_HOSTS.has(h)) return true;
  // Allow any subdomain of armgddnbrowser.com
  if (h.endsWith('.armgddnbrowser.com')) return true;
  return false;
}

function fetchJsonWithCookies(urlString, method, cookieHeader) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    if (u.protocol !== 'https:') {
      reject(new Error('Security error: HTTPS required'));
      return;
    }
    if (!isAllowedServiceHost(u.hostname)) {
      reject(new Error('Security error: Host not allowed'));
      return;
    }
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: method,
      headers: {
        'User-Agent': 'ARMGDDN-Companion/' + app.getVersion(),
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        'Accept': 'application/json'
      },
      timeout: 7000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 0, json: JSON.parse(data), text: data });
        } catch (e) {
          resolve({ statusCode: res.statusCode || 0, json: null, text: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

async function mintAppSessionTokenFromCookies(cookieHeader) {
  const { statusCode, json, text } = await fetchJsonWithCookies('https://www.armgddnbrowser.com/api/generate-app-token', 'POST', cookieHeader);
  if (statusCode !== 200 || !json || json.success !== true || !json.token) {
    const msg = (json && (json.error || json.message)) ? (json.error || json.message) : 'Failed to mint app token';
    const snippet = (text && typeof text === 'string') ? text.slice(0, 300) : '';
    throw new Error(`${msg} (HTTP ${statusCode})${snippet ? `: ${snippet}` : ''}`);
  }
  return String(json.token);
}

module.exports = { getJsonWithBearer, postJsonWithBearer, isAllowedServiceHost, fetchJsonWithCookies, mintAppSessionTokenFromCookies };
