package dev.haystack.tv;

import static org.junit.Assert.*;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.service.dreams.DreamService;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DreamFixtureTest {
    @Test public void installedServiceIsDiscoverableAndProtected() {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var matches = context.getPackageManager().queryIntentServices(
                new Intent(DreamService.SERVICE_INTERFACE).setPackage(context.getPackageName()),
                PackageManager.GET_META_DATA);
        assertEquals(1, matches.size());
        assertEquals(Manifest.permission.BIND_DREAM_SERVICE, matches.get(0).serviceInfo.permission);
        assertTrue(matches.get(0).serviceInfo.exported);
        assertNotNull(context.getDrawable(R.drawable.fixture_art));
    }
}
