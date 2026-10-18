package dev.haystack.tv;

import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class DreamArtworkController {
    private final ArtworkRepository repository;
    private final Consumer<Artwork> display;
    private final Handler main = new Handler(Looper.getMainLooper());
    private FetchCancellation session;
    private ScheduledExecutorService worker;
    private Artwork pending;

    DreamArtworkController(ArtworkRepository repository, Consumer<Artwork> display) {
        this.repository = repository;
        this.display = display;
    }

    synchronized void start() {
        if (session != null) return;
        FetchCancellation token = new FetchCancellation();
        session = token;
        worker = Executors.newSingleThreadScheduledExecutor();
        worker.execute(() -> publish(token, repository.loadCached()));
        worker.scheduleWithFixedDelay(() -> publish(token, repository.refresh(token)), 0, 60, TimeUnit.SECONDS);
    }

    private synchronized void publish(FetchCancellation token, Artwork artwork) {
        if (artwork == null) return;
        if (session != token) {
            artwork.bitmap.recycle();
            return;
        }
        main.removeCallbacksAndMessages(token);
        if (pending != null) pending.bitmap.recycle();
        pending = artwork;
        main.postAtTime(() -> {
            synchronized (DreamArtworkController.this) {
                if (session == token && pending != null) {
                    Artwork latest = pending;
                    pending = null;
                    display.accept(latest);
                }
            }
        }, token, android.os.SystemClock.uptimeMillis());
    }

    synchronized void stop() {
        if (session == null) return;
        FetchCancellation old = session;
        session = null;
        old.cancel();
        main.removeCallbacksAndMessages(old);
        if (pending != null) {
            pending.bitmap.recycle();
            pending = null;
        }
        worker.shutdownNow();
        worker = null;
    }
}
