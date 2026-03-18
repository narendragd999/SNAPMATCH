import redis
from flask import Flask, request, jsonify

app = Flask(__name__)
r = redis.Redis(host='127.0.0.1', port=6379, db=0)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'redis': str(r.ping())})

@app.route('/execute', methods=['POST'])
def execute():
    d = request.json
    cmd = d['cmd']
    args = d.get('args', [])
    result = getattr(r, cmd)(*args)
    if isinstance(result, bytes):
        result = result.decode()
    elif isinstance(result, (list, tuple)):
        result = [x.decode() if isinstance(x, bytes) else x for x in result]
    return jsonify({'result': result})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=6380, threaded=True)