use std::sync::Arc;

#[cfg(test)]
use crate::ffui_core::domain::QueueStateLite;
use crate::ffui_core::domain::{AutoCompressProgress, QueueStateUiLite};
use crate::sync_ext::MutexExt;

use super::TranscodingEngine;

impl TranscodingEngine {
    /// Register a listener for lightweight queue state changes.
    #[cfg(test)]
    pub fn register_queue_lite_listener<F>(&self, listener: F)
    where
        F: Fn(QueueStateLite) + Send + Sync + 'static,
    {
        let mut listeners = self.inner.queue_lite_listeners.lock_unpoisoned();
        listeners.push(Arc::new(listener));
    }

    /// Register a listener for UI-facing lightweight queue state changes.
    pub fn register_queue_ui_lite_listener<F>(&self, listener: F)
    where
        F: Fn(QueueStateUiLite) + Send + Sync + 'static,
    {
        let mut listeners = self.inner.queue_ui_lite_listeners.lock_unpoisoned();
        listeners.push(Arc::new(listener));
    }

    /// Register a listener for lightweight queue delta updates.
    pub fn register_queue_lite_delta_listener<F>(&self, listener: F)
    where
        F: Fn(crate::ffui_core::QueueStateLiteDelta) + Send + Sync + 'static,
    {
        let mut listeners = self.inner.queue_lite_delta_listeners.lock_unpoisoned();
        listeners.push(Arc::new(listener));
    }

    /// Register a listener for Batch Compress progress updates.
    pub fn register_batch_compress_listener<F>(&self, listener: F)
    where
        F: Fn(AutoCompressProgress) + Send + Sync + 'static,
    {
        let mut listeners = self.inner.batch_compress_listeners.lock_unpoisoned();
        listeners.push(Arc::new(listener));
    }
}
