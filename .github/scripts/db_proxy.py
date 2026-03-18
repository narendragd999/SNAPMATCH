import psycopg2, psycopg2.extras
from flask import Flask, request, jsonify

app = Flask(__name__)
DSN = 'postgresql://postgres:admin123@127.0.0.1:5432/event_ai'

def get_conn():
    return psycopg2.connect(DSN)

@app.route('/health')
def health():
    conn = get_conn(); conn.close()
    return jsonify({'status': 'ok'})

@app.route('/query', methods=['POST'])
def query():
    d = request.json
    sql = d['sql']
    args = d.get('args', [])
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, args)
    if sql.strip().upper().startswith('SELECT'):
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return jsonify({'rows': rows})
    conn.commit()
    rc = cur.rowcount
    conn.close()
    return jsonify({'rowcount': rc})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5433, threaded=True)