const crypto = require('crypto');

const jobs = new Map();
const JOB_TTL_MS = 45 * 60 * 1000;

function createJob(type) {
    const job = {
        id: crypto.randomUUID(),
        type,
        status: 'queued',
        percent: 0,
        message: 'Starting...',
        current: 0,
        total: 1,
        filePath: null,
        filename: null,
        tmpDir: null,
        error: null,
        createdAt: Date.now()
    };
    jobs.set(job.id, job);
    return job;
}

function updateJob(job, patch) {
    Object.assign(job, patch);
}

function getJob(id) {
    return jobs.get(id) || null;
}

function listJobSnapshot(job) {
    return {
        id: job.id,
        type: job.type,
        status: job.status,
        percent: Math.round(job.percent),
        message: job.message,
        current: job.current,
        total: job.total,
        filename: job.filename,
        error: job.error
    };
}

function pruneOldJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - job.createdAt > JOB_TTL_MS) {
            jobs.delete(id);
        }
    }
}

setInterval(pruneOldJobs, 10 * 60 * 1000).unref();

module.exports = { createJob, updateJob, getJob, listJobSnapshot, jobs };
