package dev.haystack.tv;

import java.io.InterruptedIOException;
import java.net.HttpURLConnection;

final class FetchCancellation {
    private volatile boolean cancelled;
    private HttpURLConnection connection;

    void check() throws InterruptedIOException {
        if (cancelled || Thread.currentThread().isInterrupted()) {
            throw new InterruptedIOException("Dream stopped");
        }
    }

    synchronized void attach(HttpURLConnection candidate) throws InterruptedIOException {
        check();
        connection = candidate;
    }

    synchronized void detach(HttpURLConnection candidate) {
        if (connection == candidate) connection = null;
    }

    synchronized void cancel() {
        cancelled = true;
        if (connection != null) connection.disconnect();
    }
}
