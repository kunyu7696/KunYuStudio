// ============================================================================
// ModMain.java - Fabric 1.20.1 reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Common (client + dedicated server) entrypoint.
// Target mapping: Yarn 1.20.1+build.10 | Loader 0.16.9 | JDK 17
// ============================================================================
package com.example.mod;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ModMain implements ModInitializer {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("Initializing {} (common)", MOD_ID);
        // Register blocks, items, entities, etc. here.
    }
}
