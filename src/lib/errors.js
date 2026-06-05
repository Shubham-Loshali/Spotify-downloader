function readStderr(error) {
    if (!error) return '';
    try {
        if (typeof error.stderr === 'function') return String(error.stderr()).trim();
        if (error.stderr) return String(error.stderr).trim();
    } catch {
        /* ignore */
    }
    return '';
}

function formatUserError(error) {
    if (!error) return 'Something went wrong. Please try again.';

    const stderr = readStderr(error);
    const rawMessage = String(error.message || '').trim();
    const technical = `${stderr}\n${rawMessage}`.toLowerCase();

    if (/sign in|not a bot|confirm you.?re|cookies/i.test(technical)) {
        return 'YouTube blocked this request. Try another match or try again later.';
    }

    if (/video unavailable|this video is unavailable|private video|has been removed/i.test(technical)) {
        return 'This video is unavailable on YouTube. Try another match.';
    }

    if (/ffmpeg|ffprobe|postprocessing|audio conversion/i.test(technical)) {
        return 'Audio conversion failed. Try another match or try again.';
    }

    if (/timed out|timeout|network|econnreset|enotfound/i.test(technical)) {
        return 'Network error while downloading. Please try again.';
    }

    if (stderr) {
        const lines = stderr.split('\n').map(line => line.trim()).filter(Boolean);
        const useful = lines.find(
            line => line.startsWith('ERROR:') || line.startsWith('WARNING:')
        );
        if (useful) {
            return useful.replace(/^(ERROR|WARNING):\s*/i, '').slice(0, 220);
        }
    }

    if (
        rawMessage.includes('command spawned') ||
        rawMessage.includes('exited with') ||
        error.name === 'ChildProcessError'
    ) {
        return 'Download failed. Try another YouTube match or try again in a few minutes.';
    }

    if (rawMessage.length > 220) return `${rawMessage.slice(0, 220)}…`;
    return rawMessage || 'Something went wrong. Please try again.';
}

module.exports = { formatUserError, readStderr };
