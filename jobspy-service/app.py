import os, json, math
from flask import Flask, request, jsonify
from jobspy import scrape_jobs

app = Flask(__name__)
SCRAPE_SECRET = os.environ.get('SCRAPE_SECRET', '')

def safe(val):
    if val is None: return None
    if isinstance(val, float) and math.isnan(val): return None
    return val

@app.route('/health')
def health():
    return jsonify({'ok': True})

@app.route('/scrape', methods=['POST'])
def scrape():
    if SCRAPE_SECRET:
        auth = request.headers.get('Authorization', '')
        if auth != f'Bearer {SCRAPE_SECRET}':
            return jsonify({'error': 'unauthorized'}), 401

    body = request.get_json(force=True)
    queries = body.get('queries', [])
    max_results = int(body.get('max_results', 50))
    sites = body.get('sites', ['indeed', 'linkedin', 'glassdoor'])

    all_jobs = []
    seen_urls = set()

    for q in queries:
        keyword  = q.get('keyword', '')
        location = q.get('location', 'United States')
        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=keyword,
                location=location,
                results_wanted=max_results,
                hours_old=48,
                country_indeed='USA',
            )
            for _, row in df.iterrows():
                direct = safe(row.get('job_url_direct'))
                indirect = safe(row.get('job_url'))
                url = direct or indirect
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                salary_min = safe(row.get('min_amount'))
                salary_max = safe(row.get('max_amount'))
                currency   = safe(row.get('currency'))
                interval   = safe(row.get('interval'))

                # Normalize to annual
                if salary_min and interval == 'hourly':
                    salary_min = salary_min * 2080
                    salary_max = salary_max * 2080 if salary_max else None
                elif salary_min and interval == 'monthly':
                    salary_min = salary_min * 12
                    salary_max = salary_max * 12 if salary_max else None

                job_type = safe(row.get('job_type'))
                if job_type:
                    job_type = str(job_type).replace('JobType.', '').lower()

                all_jobs.append({
                    'title':       safe(row.get('title')),
                    'company':     safe(row.get('company')),
                    'location':    safe(row.get('location')),
                    'apply_url':   url,
                    'description': safe(row.get('description')),
                    'remote':      bool(safe(row.get('is_remote'))),
                    'salary_min':  salary_min,
                    'salary_max':  salary_max,
                    'currency':    currency,
                    'job_type':    job_type,
                    'posted_at':   str(row['date_posted']) if safe(row.get('date_posted')) else None,
                    'source':      safe(row.get('site')),
                    'external_id': safe(row.get('id')),
                })
        except Exception as e:
            app.logger.warning(f'scrape error for query "{keyword}" / "{location}": {e}')
            continue

    return jsonify({'jobs': all_jobs, 'count': len(all_jobs)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
