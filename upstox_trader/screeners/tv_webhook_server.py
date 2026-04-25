import threading
from datetime import datetime


class TVWebhookServer:
    """Direct webhook server for real-time TV alerts"""
    def __init__(self, process_callback, log_file=None, port=5001):
        self.process_callback = process_callback
        self.log_file = log_file
        self.port = port
        self.running = False
        self.thread = None
        self.app = None
        
    def start(self):
        """Start the webhook server in a separate thread"""
        self.running = True
        self.thread = threading.Thread(target=self._run_server, daemon=True)
        self.thread.start()
        
    def stop(self):
        """Stop the webhook server"""
        self.running = False
        
    def _run_server(self):
        """Run the Flask webhook server"""
        try:
            from flask import Flask, request, jsonify
            import json
            
            self.app = Flask(__name__)
            
            @self.app.route('/webhook', methods=['POST'])
            def webhook_handler():
                try:
                    data = request.json
                    from datetime import datetime
                    
                    if self.log_file:
                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        symbol = data.get('symbol', 'UNKNOWN')
                        action = data.get('action', 'UNKNOWN')
                        price = data.get('price', '0')
                        status = 'UNKNOWN'
                        
                        with open(self.log_file, 'a') as f:
                            f.write(f"{timestamp},{symbol},{action},{price},")
                    
                    if data and data.get('action', '').upper() in ['BUY', 'LONG']:
                        if self.process_callback:
                            self.process_callback([data])
                        
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"SUCCESS\n")
                        
                        return jsonify({'status': 'success', 'message': 'BUY Alert processed'})
                    elif data and data.get('action', '').upper() in ['SELL', 'SHORT']:
                        if self.process_callback:
                            self.process_callback([data])
                        
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"SUCCESS\n")
                        
                        return jsonify({'status': 'success', 'message': 'SELL Alert processed as short position'})
                    else:
                        if self.log_file:
                            with open(self.log_file, 'a') as f:
                                f.write(f"IGNORED\n")
                        
                        return jsonify({'status': 'ignored', 'message': 'Not a trading signal'})
                except Exception as e:
                    if self.log_file:
                        from datetime import datetime
                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        with open(self.log_file, 'a') as f:
                            f.write(f"ERROR: {str(e)}\n")
                    
                    return jsonify({'status': 'error', 'message': str(e)}), 500
            
            self.app.run(host='localhost', port=self.port, debug=False, threaded=True)
        except ImportError:
            print("Flask not available - webhook server disabled")
        except Exception as e:
            print(f"Webhook server error: {e}")
