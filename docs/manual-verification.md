# Manual verification checklist (k3s-context plugin)

This checklist covers the parts of Task 10 that cannot be done by an agent:
physically dragging keys onto a Stream Deck, pressing them, and watching the
result. Everything that could be verified without touching your real
`~/.kube/config` was already verified against a disposable copy in a
separate verification pass; see the Task 10 report in the planning
repository for that evidence (kubeconfig service tests, build, typecheck,
and the plugin process registering with the Stream Deck app).

Section 5 is the safety check. Run it even if you skip everything else.

Before you start, record your current context so you can restore it at the
end. The context recorded during this verification run was:

```
current-context: agenon-vn-2
```

If your current context has changed since then, run `kubectl config
current-context` now and use that value in step 8 instead.

## 1. Confirm the plugin is linked and visible

1. Do: open the Stream Deck app. Look for a "Kubernetes Context" category in
   the action list.
   See: the category appears with two actions, "Cycle Context" and "Pin
   Context". If it does not appear, quit and reopen the Stream Deck app once;
   the app only picks up a newly linked plugin's actions on its next scan.

## 2. Verify the cycle action

2. Do: drag "Cycle Context" onto an empty key. Open its property inspector
   (double-click the key) and check three contexts from the list, then close
   the property inspector.
   See: the key's title updates to show the currently active context.

3. Do: press the key once.
   See: the key title changes to the next checked context in the order you
   checked them.

4. Do: in a **new terminal window** (not the one you used for setup), run
   `kubectl config current-context`.
   See: it prints the same context name shown on the key.

5. Do: press the key two more times.
   See: the title cycles to the next checked context each time, and wraps
   back to the first checked context after the last one. Each press again
   matches `kubectl config current-context` in the terminal.

## 3. Verify the pin action

6. Do: drag two "Pin Context" keys onto empty keys. Open each one's property
   inspector and pin a different context to each (a different context per
   key), then close both property inspectors.
   See: exactly one of the two keys is lit (highlighted); the other is dim.
   The lit key is whichever context is currently active.

7. Do: press the dim key.
   See: within about a second, that key lights up and the previously lit key
   goes dim. `kubectl config current-context` in your terminal now reports
   the context you just pinned.

8. Do: press the now-lit key again.
   See: nothing happens. The key stays lit, the context does not change, and
   no error appears.

## 4. Verify external change detection

9. Do: in a terminal, run `kubectl config use-context <a context not
   currently shown as active on any key>`.
   See: within about a second, every key touching that context updates
   without you pressing anything: the cycle key's title changes if the new
   context is one of its checked contexts, and the correct pin key lights up
   if the new context is one of the two pinned contexts.

## 5. Kubeconfig integrity check

This is the check that matters most, so read it before you run it.

The plugin does not re-serialise your kubeconfig. It replaces the
`current-context` value in the file and leaves every other byte alone,
including indentation, quoting, key order, comments and the trailing
newline. The expected result of the diff below is therefore **one changed
line**. A larger diff is not formatting noise to wave through, it is a bug:
stop, restore the backup, and report it.

10. Do: before doing anything else today, make a manual backup and record the
    context count:

    ```bash
    cp ~/.kube/config ~/.kube/config.pre-streamdeck-$(date +%Y%m%d)
    kubectl config get-contexts | wc -l
    ```

    (Skip the copy if you already have a backup from earlier today.)

11. Do: after finishing steps 1 through 9 above, diff the live file against
    that backup:

    ```bash
    diff ~/.kube/config.pre-streamdeck-$(date +%Y%m%d) ~/.kube/config
    ```

    See: exactly one changed line, the `current-context` line, like this:

    ```
    3c3
    < current-context: agenon-vn-2
    ---
    > current-context: dev
    ```

    Anything else is a failure: a whitespace or indentation change, a
    re-quoted value, a moved or dropped comment, a reordered key, a changed
    trailing newline, or any second changed line. If you see one, restore the
    backup and report it before using the plugin again:

    ```bash
    cp ~/.kube/config.pre-streamdeck-$(date +%Y%m%d) ~/.kube/config
    ```

12. Do: check the same thing mechanically, so a long diff cannot slip past:

    ```bash
    diff ~/.kube/config.pre-streamdeck-$(date +%Y%m%d) ~/.kube/config | grep -c '^[<>]'
    ```

    See: `2`, one `<` line and one `>` line. Any other number is a failure.
    (If you happened to finish on the same context you started on, the count
    is `0`; switch to a different context and run the diff again.)

13. Do: confirm the set of contexts is untouched:

    ```bash
    diff <(kubectl config get-contexts -o name | sort) \
         <(KUBECONFIG=~/.kube/config.pre-streamdeck-$(date +%Y%m%d) kubectl config get-contexts -o name | sort)
    kubectl config get-contexts | wc -l
    ```

    See: the `diff` prints nothing, and the count matches what you recorded in
    step 10. No context was renamed, added, or deleted.

14. Do: confirm the credentials still work against a cluster you trust:

    ```bash
    kubectl --context agenon-vn-2 version --request-timeout=3s
    ```

    See: it responds normally, proving the cluster and user entries for that
    context are intact.

15. Do: confirm the plugin left no stray files beside your kubeconfig:

    ```bash
    ls -l ~/.kube/config*
    ```

    See: your `config`, the `config.pre-streamdeck-*` backup you made in step
    10, and at most one `config.streamdeck-bak` that the plugin wrote before
    its first write. There must be no `config.streamdeck-tmp`: a leftover
    temp file means a write was interrupted, and `config.streamdeck-bak` is
    then the file to restore from.

    If `~/.kube/config` is a symlink (for example into a dotfiles
    repository), confirm it is still a symlink and that the file it points at
    is the one that changed:

    ```bash
    ls -l ~/.kube/config
    diff ~/.kube/config.pre-streamdeck-$(date +%Y%m%d) "$(readlink -f ~/.kube/config)"
    ```

    See: `ls -l` still shows the `->` arrow, and the diff shows the same
    single `current-context` line as step 11.

## 6. Restore

16. Do: restore your original context:

    ```bash
    kubectl config use-context agenon-vn-2
    ```

    (Replace `agenon-vn-2` with whatever `kubectl config current-context`
    reported before you started, if different.)

17. Do: remove the test keys from your Stream Deck profile if you do not
    want to keep them (drag them off, or right-click and remove).
