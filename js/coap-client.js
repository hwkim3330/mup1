/**
 * CoAP Client Implementation for CORECONF
 * RFC 7252 (CoAP) and RFC 9254 (YANG to CBOR)
 */

import { encode as cborEncode, decode as cborDecode } from './cbor.js';

export class CoAPClient {
    constructor(controller) {
        this.controller = controller;
        this.messageId = 1;
        this.token = 1;
        this.pendingRequests = new Map();
        
        // CoAP codes
        this.METHODS = {
            GET: 1,
            POST: 2,
            PUT: 3,
            DELETE: 4,
            FETCH: 5
        };
        
        this.RESPONSE_CODES = {
            201: 'Created',
            202: 'Deleted',
            203: 'Valid',
            204: 'Changed',
            205: 'Content',
            400: 'Bad Request',
            401: 'Unauthorized',
            404: 'Not Found',
            405: 'Method Not Allowed',
            500: 'Internal Server Error'
        };
    }

    /**
     * Send CoAP request
     */
    async request(method, uri, payload = null) {
        // Allocate Message ID and build CoAP message (TKL=0)
        const mid = this.messageId++;
        const message = this.buildMessage(method, uri, payload, mid);
        const frame = this.controller.protocol.createCoapFrame(message);

        // Debug logging
        if (typeof window !== "undefined" && window.__logRaw) {
            window.__logRaw('CoAP', 'TX', message, { method, uri });
            window.__logRaw('MUP1', 'TX', frame, { method, uri });
        }
        
        // Store pending request
        const promise = new Promise((resolve, reject) => {
            this.pendingRequests.set(mid, { resolve, reject, meta: { method, uri, payload } });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(mid)) {
                    this.pendingRequests.delete(mid);
                    reject(new Error('Request timeout'));
                }
            }, 10000);
        });
        await this.controller.connection.sendBytes(frame);
        
        return promise;
    }

    /**
     * Build CoAP message
     */
    buildMessage(method, uri, payload, messageId) {
        const header = [];
        
        // Version (2 bits) | Type (2 bits) | Token Length (4 bits)
        const ver = 1; // CoAP version 1
        const type = 0; // Confirmable
        const tkl = 0; // Token length (CLI는 토큰 미사용)
        header.push((ver << 6) | (type << 4) | tkl);
        
        // Code (8 bits)
        header.push(method);
        
        // Message ID (16 bits)
        header.push((messageId >> 8) & 0xFF);
        header.push(messageId & 0xFF);
        
        // Token 미사용 (TKL=0)
        
        // Options
        const options = this.encodeOptions(uri);
        header.push(...options);
        
        // Payload marker and payload
        if (payload) {
            header.push(0xFF); // Payload marker
            const encoded = cborEncode(payload);
            header.push(...encoded);
        }
        
        return new Uint8Array(header);
    }

    /**
     * Encode CoAP options
     */
    encodeOptions(uri) {
        const options = [];
        const [pathPart, queryPart] = uri.split('?');
        const segments = (pathPart || '').split('/').filter(s => s);
        
        let prevOption = 0;
        
        // Uri-Path options (Option 11)
        segments.forEach(segment => {
            const delta = 11 - prevOption;
            const length = segment.length;
            
            if (delta < 13 && length < 13) {
                options.push((delta << 4) | length);
            } else {
                // Extended option format
                let firstByte = 0;
                
                if (delta < 13) {
                    firstByte |= (delta << 4);
                } else if (delta < 269) {
                    firstByte |= (13 << 4);
                    options.push(firstByte);
                    options.push(delta - 13);
                    firstByte = 0;
                } else {
                    firstByte |= (14 << 4);
                    options.push(firstByte);
                    options.push((delta - 269) >> 8);
                    options.push((delta - 269) & 0xFF);
                    firstByte = 0;
                }
                
                if (length < 13) {
                    if (firstByte) options.push(firstByte | length);
                } else if (length < 269) {
                    if (firstByte) options.push(firstByte | 13);
                    options.push(length - 13);
                } else {
                    if (firstByte) options.push(firstByte | 14);
                    options.push((length - 269) >> 8);
                    options.push((length - 269) & 0xFF);
                }
            }
            
            // Add segment bytes
            for (let i = 0; i < segment.length; i++) {
                options.push(segment.charCodeAt(i));
            }
            
            prevOption = 11;
        });
        
        // Content-Format option (Option 12) for CBOR payload
        // NOTE: 실제 CORECONF 미디어타입은 yang-*-cbor-seq 이지만 우선 60(application/cbor) 사용
        let delta = 12 - prevOption;
        options.push((delta << 4) | 1);
        options.push(60);
        prevOption = 12;

        // Uri-Query options (Option 15) e.g., d=a
        if (queryPart) {
            const queries = queryPart.split('&').filter(Boolean);
            for (const q of queries) {
                const qBytes = [];
                for (let i = 0; i < q.length; i++) qBytes.push(q.charCodeAt(i));
                delta = 15 - prevOption;
                if (delta < 13 && qBytes.length < 13) {
                    options.push((delta << 4) | qBytes.length);
                } else {
                    // 단순 확장 형식 (길이<269 가정)
                    const first = (delta < 13 ? delta : 13) << 4 | 13;
                    options.push(first);
                    options.push(qBytes.length - 13);
                }
                options.push(...qBytes);
                prevOption = 15;
            }
        }

        return options;
    }

    /**
     * Parse CoAP response
     */
    parseResponse(data) {
        if (data.length < 4) {
            throw new Error('Invalid CoAP message');
        }
        
        const version = (data[0] >> 6) & 0x03;
        const type = (data[0] >> 4) & 0x03;
        const tokenLength = data[0] & 0x0F;
        
        const code = data[1];
        const messageId = (data[2] << 8) | data[3];
        
        let offset = 4;
        
        // Extract token
        let token = 0;
        for (let i = 0; i < tokenLength; i++) {
            token = (token << 8) | data[offset++];
        }
        
        // Parse options and find payload
        let payloadStart = data.length;
        for (let i = offset; i < data.length; i++) {
            if (data[i] === 0xFF) {
                payloadStart = i + 1;
                break;
            }
        }
        
        // Extract payload
        let payload = null;
        if (payloadStart < data.length) {
            const payloadData = data.slice(payloadStart);
            try {
                payload = cborDecode(payloadData);
            } catch (e) {
                // If not CBOR, treat as raw data
                payload = payloadData;
            }
        }
        
        return {
            version,
            type,
            code,
            messageId,
            token,
            payload
        };
    }

    /**
     * Handle CoAP response
     */
    handleResponse(data, rawFrame) {
        try {
            const response = this.parseResponse(data);
            const pending = this.pendingRequests.get(response.messageId);
            
            if (pending) {
                this.pendingRequests.delete(response.messageId);
                // Debug logging
                if (typeof window !== "undefined" && window.__logRaw) {
                    if (rawFrame) window.__logRaw('MUP1', 'RX', rawFrame, { code: response.code });
                    window.__logRaw('CoAP', 'RX', data, { code: response.code });
                }
                if (typeof window !== "undefined" && window.__pushHistory) {
                    const ok = Math.floor(response.code / 32) === 2;
                    window.__pushHistory({ method: pending.meta?.method, uri: pending.meta?.uri, payload: pending.meta?.payload, ok, code: response.code, data: response.payload });
                }
                
                const responseClass = Math.floor(response.code / 32);
                if (responseClass === 2) {
                    // Success response
                    pending.resolve(response.payload);
                } else {
                    // Error response
                    const error = new Error(this.RESPONSE_CODES[response.code] || `Error ${response.code}`);
                    error.code = response.code;
                    error.payload = response.payload;
                    pending.reject(error);
                }
            }
        } catch (error) {
            console.error('Failed to handle CoAP response:', error);
        }
    }

    /**
     * GET request
     */
    async get(uri) {
        return this.request(this.METHODS.GET, uri);
    }

    /**
     * POST request
     */
    async post(uri, data) {
        return this.request(this.METHODS.POST, uri, data);
    }

    /**
     * PUT request
     */
    async put(uri, data) {
        return this.request(this.METHODS.PUT, uri, data);
    }

    /**
     * DELETE request
     */
    async delete(uri) {
        return this.request(this.METHODS.DELETE, uri);
    }

    /**
     * FETCH request (with filter)
     */
    async fetch(uri, filter) {
        return this.request(this.METHODS.FETCH, uri, filter);
    }
}

export default CoAPClient;
