<script lang="ts">
    import { Button, Chip } from "m3-svelte";
</script>

<div class="fixed bottom-28 left-96 right-96 mx-20 rounded-full bg-secondary">
    <div class="w-full flex justify-between items-center px-4">
        <div class="rounded-3xl py-2">
            <Button square variant="filled" iconType="left">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" {...$$props}>
                    <path fill="currentColor" d="m12 13.4l-4.9 4.9q-.275.275-.7.275t-.7-.275t-.275-.7t.275-.7l4.9-4.9l-4.9-4.9q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275l4.9 4.9l4.9-4.9q.275-.275.7-.275t.7.275t.275.7t-.275.7L13.4 12l4.9 4.9q.275.275.275.7t-.275.7t-.7.275t-.7-.275z" />
                </svg>
                Deny
            </Button>
        </div>
        <div class="py-1">
            <Chip variant="general" icon={undefined} click={() => {}}>
                Move -------/------ to -------/------?
            </Chip>
        </div>
        <div class="rounded-3xl py-1">
            <Button square variant="filled" iconType="left">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" {...$$props}>
                    <path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z" />
                </svg>
                Accept
            </Button>
        </div>
    </div>
</div>