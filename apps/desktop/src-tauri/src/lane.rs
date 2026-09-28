//! A thread of its own for work a command hands off: the command sends and returns,
//! and the thread does the work, one piece at a time in the order it was sent.
//!
//! For the commands that are not `async` because their order matters, and whose
//! work still waits for something - the disk, the shell. Such a command runs on the
//! thread the window's message loop is on (see the top of lib.rs), so the waiting
//! is handed here rather than done there; and one thread per kind of work, fed by a
//! channel, keeps the order the window asked in, which a pool of threads would not.

use std::sync::mpsc::{channel, Sender};

/// Starts the thread, and answers what to send it work through. The thread lives as
/// long as the sender does, which for the statics that hold one is the process.
pub fn lane<T: Send + 'static>(work: impl Fn(T) + Send + 'static) -> Sender<T> {
    let (send, taken) = channel::<T>();
    std::thread::spawn(move || taken.into_iter().for_each(work));
    send
}

#[cfg(test)]
mod tests {
    use super::lane;
    use std::sync::mpsc::channel;

    #[test]
    fn work_is_done_in_the_order_it_was_sent() {
        let (done, heard) = channel();
        let send = lane(move |one: u32| done.send(one).expect("the test listening"));

        for one in 0..100 {
            send.send(one).expect("the lane");
        }

        let order: Vec<u32> = heard.iter().take(100).collect();
        assert_eq!(order, (0..100).collect::<Vec<_>>());
    }
}
