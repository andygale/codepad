export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | { jsonrpc: '2.0'; id: number; result?: any; error?: any };

export class LSPTransport {
  private ws: WebSocket;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private idCounter = 1;
  private notificationHandlers: Array<(msg: JsonRpcNotification) => void> = [];
  public ready: Promise<void>;

  constructor(ws: WebSocket) {
    this.ws = ws;

    this.ready = new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (ev) => reject(ev);
    });

    ws.onmessage = (ev) => {
      try {
        // Handle both text and binary WebSocket messages
        let data: string;
        if (ev.data instanceof Blob) {
          // Convert Blob to text
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const msg: JsonRpcMessage = JSON.parse(reader.result as string);
              this.handleMessage(msg);
            } catch (err) {
              console.error('Failed to parse LSP message from Blob', err);
            }
          };
          reader.readAsText(ev.data);
          return;
        } else {
          data = ev.data as string;
        }
        const msg: JsonRpcMessage = JSON.parse(data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('Failed to parse LSP message', err);
      }
    };
  }

  private handleMessage(msg: JsonRpcMessage) {
    if ('id' in msg && (msg as any).method === undefined) {
      // response
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        if ((msg as any).error) handler.reject((msg as any).error);
        else handler.resolve((msg as any).result);
      }
    } else if ('method' in msg) {
      // notification
      this.notificationHandlers.forEach((h) => h(msg as JsonRpcNotification));
    }
  }

  sendNotification(method: string, params?: any) {
    const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    console.log(`[${new Date().toISOString()}] [LSPTransport] Sending notification over WebSocket:`, method, params);
    this.ws.send(JSON.stringify(notif));
  }

  sendRequest(method: string, params?: any): Promise<any> {
    const id = this.idCounter++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    this.ws.send(JSON.stringify(req));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Use longer timeout for initialize requests (Kotlin LS needs time for dependency resolution)
      const timeoutMs = method === 'initialize' ? 60000 : 10000;
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('LSP request timeout'));
        }
      }, timeoutMs);
    });
  }

  onNotification(handler: (msg: JsonRpcNotification) => void) {
    this.notificationHandlers.push(handler);
  }

  close() {
    this.ws.close();
    this.pending.clear();
  }
}
